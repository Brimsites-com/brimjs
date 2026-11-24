// Blocks whose settings were carried over from BrimCMS.
import type { BlockDefinition } from "../types.ts";
import { accordion } from "./accordion.ts";
import { button } from "./button.ts";
import { carousel } from "./carousel.ts";
import { divider } from "./divider.ts";
import { form } from "./form.ts";
import { icon } from "./icon.ts";
import { image } from "./image.ts";
import { imageGallery } from "./image-gallery.ts";
import { listing } from "./listing.ts";
import { map } from "./map.ts";
import { newsletter } from "./newsletter.ts";
import { socialMedia } from "./social-media.ts";
import { text } from "./text.ts";
import { video } from "./video.ts";

export const blockDefinitions: Record<string, BlockDefinition> = {
  accordion,
  button,
  carousel,
  divider,
  form,
  icon,
  image,
  "image-gallery": imageGallery,
  listing,
  map,
  newsletter,
  "social-media": socialMedia,
  text,
  video,
};
