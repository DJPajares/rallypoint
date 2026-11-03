/** "the East region", or "the East and Central regions". */
export const regionLabel = (regions: string[]) =>
  regions.length > 1
    ? `the ${regions.join(" and ")} regions`
    : `the ${regions[0] ?? ""} region`;
