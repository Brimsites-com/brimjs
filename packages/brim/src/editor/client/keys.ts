/** A key event as the page gives it, or as React wraps it. */
interface KeyLike {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}

/**
 * Whether the key belongs to an input method still composing a word (Japanese, Chinese, Korean): there Enter picks
 * a candidate and Escape cancels it, so neither may send, save or close anything. Safari reports the key that ends
 * the composition with keyCode 229 and `isComposing` already false.
 */
export function isComposing(event: KeyLike): boolean {
  return Boolean(event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229);
}
