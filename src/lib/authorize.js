// Policy Decision Point (DESIGN §6/§7). Every case/document/audit operation
// routes through here so the enforcement point is single and greppable.
// Evaluates RBAC + ABAC: role permission ∩ case assignment ∩ clearance ≥
// classification ∩ jurisdiction. The user is re-loaded from the DB on each call
// so a deactivated account or changed clearance takes effect immediately rather
// than living on inside an already-issued access token.
// Grep "authorize(" to find every guarded action.

import { toMe } from "../mapper/user.mapper.js";
import { forbidden } from "./errors.js";
import userRepository from "../repositories/user.repository.js";
import caseRepository from "../repositories/case.repository.js";
import { getDocumentById } from "../repositories/documents.repo.js";

const clearanceRank = {
  PUBLIC: 0,
  RESTRICTED: 1,
  CONFIDENTIAL: 2,
  SECRET: 3,
};

const elevatedCaseRoles = new Set(["SUPERVISOR", "ORG_ADMIN", "SYSTEM_ADMIN"]);

const permissionAliases = {
  "case:list": ["case:list", "case:read", "cases:read"],
  "case:read": ["case:read", "cases:read"],
  "case:create": ["case:create", "case:manage", "cases:manage"],
  "case:update": ["case:update", "case:manage", "cases:manage"],
  "case:manage": ["case:manage", "cases:manage"],
  "case:legal-hold": ["case:legal-hold", "case:manage", "cases:manage"],
  "document:read": ["document:read", "documents:read"],
  "document:list": ["document:list", "document:read", "documents:read"],
  "document:download": ["document:download", "document:read", "documents:read"],
  "document:create": ["document:create", "document:write", "documents:write"],
  "document:add-version": ["document:add-version", "document:write", "documents:write"],
  "document:restore": ["document:restore", "document:write", "documents:write"],
  "document:sign": ["document:sign", "documents:sign"],
  "document:seal": ["document:seal", "document:manage", "documents:manage"],
  "document:delete": ["document:delete", "document:manage", "documents:manage"],
};

function hasPermission(permissions, action) {
  const required = permissionAliases[action] ?? [action];
  return permissions.includes("*") || required.some((permission) => permissions.includes(permission));
}

async function resolveCase(resource = {}) {
  if (resource.caseId) return caseRepository.findById(resource.caseId);
  if (resource.documentId) {
    const document = await getDocumentById(resource.documentId);
    return document ? caseRepository.findById(document.caseId) : null;
  }
  return null;
}

async function canAccessCase(user, caseRow) {
  if (!caseRow || user.jurisdiction !== caseRow.jurisdiction) return false;
  const userClearance = clearanceRank[user.clearance];
  const caseClassification = clearanceRank[caseRow.classification];
  if (userClearance === undefined || caseClassification === undefined || userClearance < caseClassification) {
    return false;
  }
  if (elevatedCaseRoles.has(user.role)) return true;
  if (caseRow.createdBy === user.id) return true;

  const officers = await caseRepository.listOfficers(caseRow.id);
  return officers.some((officer) => officer.userId === user.id);
}

export async function authorize({ user, action, resource = {} }) {
  if (!user?.id) throw forbidden("authenticated user is required");

  const currentUser = await userRepository.findById(user.id);
  if (!currentUser || currentUser.status !== "ACTIVE") {
    throw forbidden("user is not active");
  }

  const permissions = toMe(currentUser).permissions;
  if (!hasPermission(permissions, action)) {
    throw forbidden(`user ${currentUser.id} is not permitted to perform ${action}`);
  }

  const isResourceAction = Boolean(resource.caseId || resource.documentId || resource.versionId);
  if (isResourceAction) {
    const caseRow = await resolveCase(resource);
    if (!(await canAccessCase(currentUser, caseRow))) {
      throw forbidden("user is not permitted to access this case");
    }
  }

  return true;
}
