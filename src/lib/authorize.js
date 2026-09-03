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
import { db } from "../db/index.js";
import * as pools from "../governance/pools.js";
import { getActivePolicy } from "./abacPolicy.js";

// clearanceRank / elevatedCaseRoles / permissionAliases used to be module-level
// constants here. They now live in src/lib/abacPolicy.js (DEFAULT_POLICY) and are
// resolved per request via getActivePolicy(), which layers any active
// CHANGE_ABAC_POLICY override on top. With no override the values are identical.

function hasPermission(permissions, action, permissionAliases) {
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

async function canAccessCase(user, caseRow, policy) {
  if (!caseRow || user.jurisdictionId !== caseRow.jurisdictionId) return false;
  const clearanceRank = policy.clearanceRank;
  const userClearance = clearanceRank[user.clearance];
  const caseClassification = clearanceRank[caseRow.classification];
  if (userClearance === undefined || caseClassification === undefined || userClearance < caseClassification) {
    return false;
  }
  if (policy.elevatedCaseRoles.includes(user.role)) return true;
  if (caseRow.createdBy === user.id) return true;

  const officers = await caseRepository.listOfficers(caseRow.id);
  return officers.some((officer) => officer.userId === user.id);
}

export async function authorize({ user, action, resource = {} }) {
  if (!user?.id) throw forbidden("authenticated user is required");

  // Resolve the active policy first. This refreshes the shared cache, so the
  // subsequent toMe() (which reads it synchronously) sees the same fresh policy.
  const policy = await getActivePolicy();

  const currentUser = await userRepository.findById(user.id);
  if (!currentUser || currentUser.status !== "ACTIVE") {
    throw forbidden("user is not active");
  }

  const permissions = toMe(currentUser).permissions;
  if (!hasPermission(permissions, action, policy.permissionAliases)) {
    throw forbidden(`user ${currentUser.id} is not permitted to perform ${action}`);
  }

  const isResourceAction = Boolean(resource.caseId || resource.documentId || resource.versionId);
  if (isResourceAction) {
    const caseRow = await resolveCase(resource);
    if (!(await canAccessCase(currentUser, caseRow, policy))) {
      throw forbidden("user is not permitted to access this case");
    }
  }

  return true;
}

// Coarse governance gate: assert an ACTIVE user is a member of a specific admin
// pool. Re-loads the user from the DB (never trusts the token) and checks
// admin_pool_members. The fine-grained per-action eligibility (in-pool vs.
// cross-tier co-sign) and quorum are still re-checked inside proposals.service —
// this is the reusable "is this actor even in the pool" primitive.
export async function requirePoolMembership(userId, poolType, org = null) {
  if (!userId) throw forbidden("authenticated user is required");
  const currentUser = await userRepository.findById(userId);
  if (!currentUser || currentUser.status !== "ACTIVE") {
    throw forbidden("user is not active");
  }
  if (!(await pools.isMember(db, userId, poolType, org))) {
    throw forbidden(`user is not a member of the ${poolType} pool`);
  }
  return true;
}
