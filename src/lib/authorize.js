// Policy Decision Point seam (DESIGN §6/§7). Every document operation routes
// through here so the enforcement point is single and greppable. It will
// evaluate RBAC + ABAC: role permission ∩ case assignment ∩ clearance ≥
// classification ∩ jurisdiction.
//
// NOT YET IMPLEMENTED — currently allows everything. The frontend <Can> gate is
// UX-only; real enforcement must live here before any real data is served.
// Grep "authorize(" to find every guarded action.
export async function authorize(/* { user, action, resource } */) {
  return true;
}
