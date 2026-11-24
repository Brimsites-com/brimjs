import { useEffect, useState } from "react";
import { type ContentType, api } from "./api.ts";
import { FolderIcon, PlusIcon } from "./icons.tsx";
import { Sidebar } from "./Sidebar.tsx";

/** What `<Listing>` tells the editor: its type, how many items it shows, and what a new item starts with. */
interface ListingInfo {
  type: string;
  count: number;
  prefill: Record<string, unknown>;
}

function readListing(element: HTMLElement): ListingInfo | undefined {
  try {
    const value = JSON.parse(element.dataset.brimValue ?? "") as Partial<ListingInfo>;
    if (typeof value.type !== "string") return undefined;
    return { type: value.type, count: Number(value.count) || 0, prefill: value.prefill ?? {} };
  } catch {
    return undefined;
  }
}

/**
 * The panel of a selected listing. What it shows is the site's code; the owner changes what is listed by editing
 * the items, so the panel opens them, or adds one that lands in this listing (its filter fills the new item in).
 */
export function ListingPanel({
  element,
  onOpen,
  onNew,
  onClose,
}: {
  element: HTMLElement;
  onOpen: (type: string) => void;
  onNew: (type: string, prefill: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const listing = readListing(element);
  const [type, setType] = useState<ContentType | undefined>();
  useEffect(() => {
    if (!listing) return;
    void api.types().then(({ types }) => setType(types.find((candidate) => candidate.key === listing.type)));
  }, [listing?.type]);

  if (!listing) {
    return (
      <Sidebar title="Listing" onClose={onClose}>
        <p className="brim-sidebar-note">This listing does not say which content it shows.</p>
      </Sidebar>
    );
  }
  const label = type?.label ?? listing.type;
  const singular = type?.singular ?? "item";
  const prefilled = Object.entries(listing.prefill);

  return (
    <Sidebar title={label} onClose={onClose}>
      <div className="brim-listing-panel">
        <p className="brim-listing-panel__count">
          {listing.count} {listing.count === 1 ? "item" : "items"} in this listing
        </p>
        <p className="brim-sidebar-note">
          Which {label.toLowerCase()} show here, and in what order, is set in the site's code. Change what it lists by
          editing the {label.toLowerCase()}: a private one shows only here in the editor until it is published.
        </p>
        <div className="brim-listing-panel__actions">
          <button type="button" className="url-browse-btn" onClick={() => onNew(listing.type, listing.prefill)}>
            <PlusIcon />
            New {singular.toLowerCase()}
          </button>
          <button
            type="button"
            className="brim-toolbar-btn brim-toolbar-btn--outline"
            onClick={() => onOpen(listing.type)}
          >
            <FolderIcon />
            Open {label.toLowerCase()}
          </button>
        </div>
        {prefilled.length > 0 && (
          <p className="field-description">
            A new {singular.toLowerCase()} added here starts with{" "}
            {prefilled.map(([field, value], index) => (
              <span key={field}>
                {index > 0 && ", "}
                <strong>{fieldLabel(type, field)}</strong>: {String(value)}
              </span>
            ))}
            , so it shows in this listing.
          </p>
        )}
      </div>
    </Sidebar>
  );
}

function fieldLabel(type: ContentType | undefined, field: string): string {
  return type?.fields.find((candidate) => candidate.name === field)?.label ?? field;
}
