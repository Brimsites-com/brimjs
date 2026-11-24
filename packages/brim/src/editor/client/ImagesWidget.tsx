import { type ReactNode, useEffect, useState } from "react";
import { TextWidget } from "./fields.tsx";
import { LinkWidget } from "./LinkWidget.tsx";
import { CardList, ImageUploadWidget } from "./widgets.tsx";

/** One image of a list: its address and description, and what a gallery or carousel block also keeps. */
export interface ListedImage {
  url?: unknown;
  alt?: unknown;
  caption?: unknown;
  link?: unknown;
  title?: unknown;
  [key: string]: unknown;
}

/**
 * Several images, the same widget wherever they are edited: a gallery or carousel block, and an item's `gallery`
 * field. Each is a card with its picture, opened to change the image and describe it; cards are moved and removed
 * from their row. `extras` adds what a block keeps beside each image (a caption, a link); a field keeps none.
 */
export function ImagesWidget({
  label,
  images,
  extras = false,
  onChange,
}: {
  label: string;
  images: ListedImage[];
  extras?: boolean;
  onChange: (images: ListedImage[]) => void;
}) {
  return (
    <CardList<ListedImage>
      label={label}
      addLabel="Add image"
      entries={images}
      title={(entry, index) => String(entry.title || entry.caption || entry.alt || `Image ${index + 1}`)}
      thumbnail={(entry) => (typeof entry.url === "string" && entry.url ? entry.url : undefined)}
      create={() => ({ url: "", alt: "" })}
      render={(entry, change) => {
        const field = (key: string, title: string): ReactNode => (
          <TextWidget
            label={title}
            value={String(entry[key] ?? "")}
            onChange={(next) => change({ ...entry, [key]: next })}
          />
        );
        return (
          <>
            <ImageUploadWidget
              label="Image"
              value={String(entry.url ?? "")}
              onChange={(url) => change({ ...entry, url })}
            />
            {field("alt", "Alt Text")}
            {extras && field("caption", "Caption")}
            {extras && (
              <LinkWidget
                label="Link"
                value={String(entry.link ?? "")}
                onChange={(link) => change({ ...entry, link })}
              />
            )}
          </>
        );
      }}
      onChange={onChange}
    />
  );
}

/**
 * An item's `gallery` field (`[{ src, alt }]`) in the images widget, which speaks of `url`: what the owner sees and
 * does is the same as in a gallery block. An image left without a picture is not kept.
 */
export function GalleryFieldWidget({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: { src: string; alt: string }[]) => void;
}) {
  const fromValue = (): ListedImage[] =>
    (Array.isArray(value) ? (value as Record<string, unknown>[]) : []).map((image) => ({
      url: image.src,
      alt: image.alt,
    }));
  // A card just added has no picture yet: it stays here until it gets one, and only pictures are saved.
  const [images, setImages] = useState<ListedImage[]>(fromValue);
  const saved = (list: ListedImage[]) =>
    list
      .filter((image) => typeof image.url === "string" && image.url !== "")
      .map((image) => ({ src: String(image.url), alt: String(image.alt ?? "") }));
  // Changed elsewhere (on the page, by an undo), the field shows the item's images again.
  useEffect(() => {
    if (JSON.stringify(saved(images)) !== JSON.stringify(saved(fromValue()))) setImages(fromValue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <ImagesWidget
      label={label}
      images={images}
      onChange={(next) => {
        setImages(next);
        const kept = saved(next);
        if (JSON.stringify(kept) !== JSON.stringify(saved(images))) onChange(kept);
      }}
    />
  );
}
