import { conflict, notFound } from "../lib/errors.js";
import { orgRepository, jurisdictionRepository } from "../repositories/reference.repository.js";

// Both orgs and jurisdictions are admin-managed lookups with an identical CRUD
// shape (see reference.repository.js). users.org / users.jurisdiction /
// cases.jurisdiction remain plain text columns (not FKs) — they store the
// `name`, not the row id — so:
//   - renaming a value does NOT retroactively update rows that already
//     reference the old name (they keep the old free-text value)
//   - deleting, or renaming to a different value, a name still in use would
//     silently strand those rows (authorize.js does a strict `===` match,
//     e.g. cases_jurisdiction, admin_pools.org), so both are blocked here
//     while usages exist. Deactivating (active=false) is the safe way to
//     retire a value without breaking existing references.
function makeService(repository, kind) {
  return {
    async list(filters) {
      return repository.list(filters);
    },

    async get(id) {
      const row = await repository.findById(id);
      if (!row) throw notFound(`${kind} not found`);
      return row;
    },

    async create(values) {
      const existing = await repository.findByName(values.name);
      if (existing) throw conflict(`${kind} '${values.name}' already exists`);
      return repository.create(values);
    },

    async update(id, values) {
      const row = await repository.findById(id);
      if (!row) throw notFound(`${kind} not found`);

      if (values.name && values.name !== row.name) {
        const existing = await repository.findByName(values.name);
        if (existing) throw conflict(`${kind} '${values.name}' already exists`);
        const usages = await repository.countUsages(row.name);
        if (usages > 0) {
          throw conflict(
            `${kind} '${row.name}' is referenced by ${usages} existing record(s); deactivate it instead of renaming`,
            "IN_USE",
          );
        }
      }

      return repository.update(id, values);
    },

    async remove(id) {
      const row = await repository.findById(id);
      if (!row) throw notFound(`${kind} not found`);

      const usages = await repository.countUsages(row.name);
      if (usages > 0) {
        throw conflict(
          `${kind} '${row.name}' is referenced by ${usages} existing record(s); deactivate it instead of deleting`,
          "IN_USE",
        );
      }

      return repository.remove(id);
    },
  };
}

export const orgService = makeService(orgRepository, "org");
export const jurisdictionService = makeService(jurisdictionRepository, "jurisdiction");
