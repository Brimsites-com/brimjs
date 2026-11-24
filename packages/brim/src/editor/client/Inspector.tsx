import { useState } from "react";
import type { BlockLayout } from "../../content/block-layout.ts";
import { BlockSettings } from "./BlockSettings.tsx";
import { SelectWidget, SettingField } from "./fields.tsx";
import type { FormValue, NodeKind } from "./kinds.ts";
import { Fieldset, Sidebar } from "./Sidebar.tsx";

/** The settings of the selected node. Every change is saved as soon as it is made. */
export function Inspector({
  element,
  kind,
  note,
  only,
  onChange,
  onReset,
  resetNote,
  layout,
  onClose,
}: {
  element: HTMLElement;
  kind: NodeKind;
  /** Where else a change shows, for a node shared by every page or by every item's page. */
  note: string | undefined;
  /** The block settings to show, when only some of them can be changed here. */
  only: ((name: string) => boolean) | undefined;
  onChange: (form: FormValue) => void;
  /** Absent when there is nothing of the element's own to reset here. */
  onReset: (() => void) | undefined;
  /** Where a reset shows: this page, every page, or every item of a type. */
  resetNote?: string | undefined;
  /** For a block of a `blocks` field: how wide it is and to which side, where no code of the site places it. */
  layout?: { value: BlockLayout; onChange: (layout: BlockLayout) => void } | undefined;
  onClose: () => void;
}) {
  const [placed, setPlaced] = useState(layout?.value);
  const [form, setForm] = useState(() => kind.read(element));

  function change(next: FormValue): void {
    setForm(next);
    onChange(next);
  }

  return (
    <Sidebar title={`${kind.title} Settings`} onClose={onClose}>
      {note && <p className="brim-sidebar-note">{note}</p>}
      {kind.block ? (
        <BlockSettings definition={kind.block} value={form} only={only} onChange={change} />
      ) : (
        <Fieldset title="Default" open>
          <SettingField schema={kind.schema(element)} value={form} onChange={(next) => change(next as FormValue)} />
        </Fieldset>
      )}
      {layout && placed && (
        <Fieldset title="Layout">
          <SelectWidget
            label="Width"
            description="How wide the block is in the page's column."
            options={[
              { value: "narrow", label: "Narrow" },
              { value: "content", label: "As the text" },
              { value: "wide", label: "Wide" },
              { value: "full", label: "Full width" },
            ]}
            value={placed.width}
            onChange={(width) => {
              const next = { ...placed, width: width as BlockLayout["width"] };
              setPlaced(next);
              layout.onChange(next);
            }}
          />
          <SelectWidget
            label="Position"
            description="Where it sits when it is narrower than the column."
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
            value={placed.align}
            onChange={(align) => {
              const next = { ...placed, align: align as BlockLayout["align"] };
              setPlaced(next);
              layout.onChange(next);
            }}
          />
          <SelectWidget
            label="Space above"
            description="In steps of the site's spacing between blocks."
            options={[
              { value: "none", label: "None" },
              { value: "small", label: "Small" },
              { value: "normal", label: "Normal" },
              { value: "large", label: "Large" },
            ]}
            value={placed.space}
            onChange={(space) => {
              const next = { ...placed, space: space as BlockLayout["space"] };
              setPlaced(next);
              layout.onChange(next);
            }}
          />
        </Fieldset>
      )}
      {kind.options && (
        <BlockSettings
          definition={kind.options}
          value={(form.options ?? {}) as FormValue}
          openFirst={false}
          onChange={(options) => change({ ...form, options })}
        />
      )}
      {onReset && (
        <Fieldset title="Reset">
          <div className="field-group">
            <p className="field-description">
              Removes everything you changed on this element (its text, image, link or settings) and brings back what
              the site's code says. {resetNote} It can't be undone.
            </p>
            <button type="button" className="brim-toolbar-btn brim-toolbar-btn--outline" onClick={onReset}>
              Reset to original
            </button>
          </div>
        </Fieldset>
      )}
    </Sidebar>
  );
}
