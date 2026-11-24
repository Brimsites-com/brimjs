/** Lets `tsc` resolve component re-exports; real component types come from Astro's own tooling. */
declare module "*.astro" {
  const Component: (props: Record<string, unknown>) => unknown;
  export default Component;
}
