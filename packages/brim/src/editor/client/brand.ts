import { useEffect, useState } from "react";
import { loadSiteInfo } from "./api.ts";

export interface BrandColor {
  name: string;
  value: string;
}

/** The brand colors the site's config names; empty until known, and for sites that name none. */
export function useBrandColors(): BrandColor[] {
  const [colors, setColors] = useState<BrandColor[]>([]);
  useEffect(() => {
    let current = true;
    void loadSiteInfo().then((info) => current && setColors(info.brandColors ?? []));
    return () => {
      current = false;
    };
  }, []);
  return colors;
}
