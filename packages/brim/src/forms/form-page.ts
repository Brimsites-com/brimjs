/**
 * The page a form was sent from, out of the form's id (`/produse/ceramica/marazzi-art#comanda-form`): the same form
 * placed in a template (a product's order form) is sent from every item's page, and this says which one.
 * `undefined` for a form declared by name, which has no page in its id.
 */
export function formPage(form: string): string | undefined {
  const page = form.split("#")[0] ?? "";
  return page.startsWith("/") && form.includes("#") ? page : undefined;
}
