// Shared browse rules; availability uses the same checks as selection.
export function filterResources(pool, { query = '', category = '전체', availableOnly = false }, isAvailable) {
  const term = query.trim().toLocaleLowerCase();
  return pool.filter(resource => {
    const text = [resource.name, resource.model, resource.code, resource.location,
      resource.category, ...resource.specs, ...resource.contents].join(' ').toLocaleLowerCase();
    return (category === '전체' || resource.category === category)
      && text.includes(term) && (!availableOnly || isAvailable(resource));
  });
}

export function conditionsMatch(draft, applied, kind) {
  return Boolean(applied && draft.start === applied.start && draft.end === applied.end
    && (kind !== 'facility' || (draft.people === applied.people && draft.use === applied.use)));
}
