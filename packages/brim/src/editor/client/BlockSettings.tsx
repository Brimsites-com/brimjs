import { type ReactNode, useState } from "react";
import { VideoUpload } from "./VideoUpload.tsx";
import type { BlockDefinition, SchemaProperty } from "../../blocks/types.ts";
import { isEmbeddedVideo } from "../../blocks/video/video-source.ts";
import { DEFAULT_FILE_TYPES, FILE_TYPES, MAX_FILES, MAX_FILE_BYTES, fileSize } from "../../forms/file-types.ts";
import { FIELD_TYPES, STEP } from "../../forms/fields.ts";
import { useEditor } from "./context.ts";
import { CheckboxWidget, SelectWidget, TextWidget } from "./fields.tsx";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from "./icons.tsx";
import type { FormValue } from "./kinds.ts";
import { LinkWidget } from "./LinkWidget.tsx";
import { ImagesWidget, type ListedImage } from "./ImagesWidget.tsx";
import { Fieldset } from "./Sidebar.tsx";
import {
  BreakpointNumberWidget,
  CardList,
  ColorSelectWidget,
  FitWidget,
  FocusWidget,
  IconPickerWidget,
  ImageUploadWidget,
  LocationSearch,
  RangeWidget,
  ShapeWidget,
  SizeWidget,
  SocialNetworksWidget,
} from "./widgets.tsx";

/** The named button looks, in the order BrimCMS offered them. */
const BUTTON_VARIANTS = [
  { value: "light-1", label: "Light 1" },
  { value: "light-2", label: "Light 2" },
  { value: "light-3", label: "Light 3" },
  { value: "accent", label: "Accent" },
  { value: "block", label: "Default" },
  { value: "dark-1", label: "Dark 1" },
  { value: "dark-2", label: "Dark 2" },
  { value: "ghost", label: "Outline" },
];

/** Used when a schema names no choices for an alignment, as BrimCMS's widget did. */
const DEFAULT_ALIGNMENTS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const ALIGN_ICONS: Record<string, () => ReactNode> = {
  left: AlignLeftIcon,
  center: AlignCenterIcon,
  right: AlignRightIcon,
};

/** Widgets this inspector can draw. A setting with any other widget is listed as not editable yet. */
const SUPPORTED_WIDGETS = new Set([
  "checkbox",
  "boolean",
  "select",
  "size",
  "button-variant",
  "icon-picker",
  "alignment",
  "range",
  "number",
  "integer",
  "icon-grid-breakpoint-number",
  "carousel-slides-per-view",
  "color-select",
  "url",
  "textarea",
  "richtext",
  "text",
  "string",
  "image",
  "image-focus",
  "image-shape",
  "carousel-images",
  "accordion-items",
  "image-fit",
  "video",
  "social-network-order",
  "map-points",
  "form-fields",
  "form-richtext",
  "form-email-field",
]);

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Short text",
  name: "Name",
  email: "Email",
  tel: "Phone",
  url: "Web address",
  number: "Number",
  date: "Date",
  textarea: "Long text",
  select: "Dropdown",
  radio: "Single choice",
  checkboxes: "Several choices",
  checkbox: "Checkbox",
  file: "File upload",
};
const FIELD_TYPE_OPTIONS = [
  ...FIELD_TYPES.map((type) => ({ value: type, label: FIELD_TYPE_LABELS[type] ?? type })),
  { value: STEP, label: "New step (starts a page of the form)" },
];
const FIELD_WIDTH_OPTIONS = [
  { value: "full", label: "Whole row" },
  { value: "half", label: "Half, next to another half" },
];

const FIELD_DISPLAY_OPTIONS = [
  { value: "list", label: "A list" },
  { value: "cards", label: "Cards to click" },
];

/** The words of a choice, kept as text or as `{ label, image, icon, description }`. */
const choiceText = (option: unknown): string =>
  typeof option === "string" ? option : String((option as FormValue | null)?.label ?? "");

/** `Your e-mail address` → `your_e_mail_address`, the name a field's answer is sent under. */
function fieldName(label: string): string {
  const name = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(name) ? name.slice(0, 40) : `field_${name}`.slice(0, 40);
}

type Properties = Record<string, SchemaProperty>;

/** A block's settings, laid out in the collapsible sections its schema declares. */
export function BlockSettings({
  definition,
  value,
  openFirst = true,
  only,
  onChange,
}: {
  definition: BlockDefinition;
  value: FormValue;
  /** The first section starts open, as it did in BrimCMS, unless another section above already is. */
  openFirst?: boolean;
  /** Leaves out the settings it says no to, e.g. an image's address when that belongs to an item. */
  only?: ((name: string) => boolean) | undefined;
  onChange: (value: FormValue) => void;
}): ReactNode {
  const { fieldsets, properties } = definition.schema;
  const listed = fieldsets.flatMap((fieldset) =>
    fieldset.fields.flatMap((name) => {
      const property = properties[name];
      return property && isShown(property, value) && (only?.(name) ?? true) ? [{ fieldset, name, property }] : [];
    }),
  );
  const sections = fieldsets
    .map((fieldset) => ({
      fieldset,
      fields: listed.filter((field) => field.fieldset === fieldset && isSupported(field.property)),
    }))
    .filter((section) => section.fields.length > 0);
  const missing = listed.filter((field) => !isSupported(field.property)).map((field) => field.property.title);

  return (
    <>
      {sections.map(({ fieldset, fields }, index) => (
        <Fieldset key={fieldset.id} title={fieldset.title} open={openFirst && index === 0}>
          {fields.map(({ name, property }) => (
            <PropertyField
              key={name}
              name={name}
              property={property}
              properties={properties}
              settings={value}
              onPatch={(patch) => onChange({ ...value, ...patch })}
            />
          ))}
        </Fieldset>
      ))}
      {missing.length > 0 && <p className="brim-sidebar-note">Not editable here yet: {missing.join(", ")}.</p>}
    </>
  );
}

function isSupported(property: SchemaProperty): boolean {
  return SUPPORTED_WIDGETS.has(property.widget ?? property.type ?? "");
}

type Condition = Record<string, unknown>;

/**
 * `showWhen` lists other settings and the values they must have for this one to appear.
 * A list means "any of these"; `$or` holds alternative conditions.
 */
function isShown(property: SchemaProperty, settings: FormValue): boolean {
  return property.widget !== "hidden" && matches(property.showWhen, settings);
}

function matches(condition: Condition | undefined, settings: FormValue): boolean {
  return Object.entries(condition ?? {}).every(([name, expected]) => {
    if (name === "$or") return (expected as Condition[]).some((alternative) => matches(alternative, settings));
    const actual = settings[name];
    if (Array.isArray(expected)) return expected.includes(actual);
    return typeof expected === "boolean" ? Boolean(actual) === expected : actual === expected;
  });
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function bounds(property: SchemaProperty | undefined): { min: number; max: number; step: number } {
  return {
    min: property?.min ?? property?.minimum ?? 0,
    max: property?.max ?? property?.maximum ?? 100,
    step: property?.step ?? 1,
  };
}

function PropertyField({
  name,
  property,
  properties,
  settings,
  onPatch,
}: {
  name: string;
  property: SchemaProperty;
  /** Every setting of the block: some widgets edit a second setting next to their own. */
  properties: Properties;
  settings: FormValue;
  onPatch: (patch: FormValue) => void;
}): ReactNode {
  const { viewport } = useEditor();
  const label = property.title ?? "";
  const description = property.description;
  const current = settings[name] ?? property.default;
  const options = (property.options ?? []).map((option) => ({ value: String(option.value), label: option.label }));
  const placeholder = typeof property.placeholder === "string" ? property.placeholder : undefined;
  const set = (value: unknown): void => onPatch({ [name]: value });
  const key = (field: string): string | undefined =>
    typeof property[field] === "string" ? (property[field] as string) : undefined;

  switch (property.widget ?? property.type) {
    case "checkbox":
    case "boolean":
      return (
        <CheckboxWidget
          label={label}
          description={description}
          checked={current === true || current === "cover"}
          onChange={set}
        />
      );

    case "select":
      return (
        <SelectWidget
          label={label}
          description={description}
          options={options}
          value={String(current)}
          // Numeric choices are stored as numbers, as the schema declares them.
          onChange={(next) => set(property.type === "number" ? Number(next) : next)}
        />
      );

    case "size": {
      const customField = key("customValueField");
      const customProperty = customField ? properties[customField] : undefined;
      return (
        <SizeWidget
          label={label}
          description={description}
          options={options}
          value={String(current)}
          custom={
            customField && customProperty
              ? {
                  title: customProperty.title ?? "Custom",
                  value: numberOf(settings[customField], numberOf(customProperty.default, 0)),
                  ...bounds(customProperty),
                  onChange: (next) => onPatch({ [customField]: next }),
                }
              : undefined
          }
          onChange={set}
        />
      );
    }

    case "button-variant":
      return <SelectWidget label={label} options={BUTTON_VARIANTS} value={String(current)} onChange={set} />;

    case "icon-picker":
      return <IconPickerWidget label={label} value={String(current)} onChange={set} />;

    case "alignment":
      return (
        <AlignmentWidget
          label={label}
          description={description}
          options={options.length > 0 ? options : DEFAULT_ALIGNMENTS}
          value={String(current)}
          onChange={set}
        />
      );

    case "range":
    case "number":
    case "integer":
      return (
        <RangeWidget
          label={label}
          description={description}
          value={numberOf(current, 0)}
          {...bounds(property)}
          defaultValue={numberOf(property.default, 0)}
          onChange={set}
        />
      );

    case "carousel-slides-per-view":
    case "icon-grid-breakpoint-number": {
      // The carousel names its tablet and mobile settings by convention rather than in the schema.
      const prefixed = (prefix: string): string => `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
      const fields = [name, key("tabletField") ?? prefixed("tablet"), key("mobileField") ?? prefixed("mobile")];
      return (
        <BreakpointNumberWidget
          label={label}
          description={description}
          values={fields.map((field) => {
            const fieldProperty = field ? properties[field] : undefined;
            if (!field || !fieldProperty) return undefined;
            return {
              value: numberOf(settings[field], numberOf(fieldProperty.default, 1)),
              ...bounds(fieldProperty),
              onChange: (next: number) => onPatch({ [field]: next }),
            };
          })}
        />
      );
    }

    case "color-select":
      return (
        <ColorSelectWidget
          label={label}
          description={description}
          options={options}
          value={String(current ?? "")}
          allowCustom={property.allowCustomColor === true}
          onChange={set}
        />
      );

    case "url": {
      const newTabField = key("newTabField");
      return (
        <LinkWidget
          label={label}
          description={description}
          value={String(current ?? "")}
          placeholder={placeholder}
          newTab={
            newTabField
              ? { checked: settings[newTabField] === true, onChange: (checked) => onPatch({ [newTabField]: checked }) }
              : undefined
          }
          onChange={set}
        />
      );
    }

    case "image":
      return <ImageUploadWidget label={label} description={description} value={String(current ?? "")} onChange={set} />;

    case "image-focus":
      return (
        <ImageFocusField label={label} property={property} settings={settings} viewport={viewport} onPatch={onPatch} />
      );

    case "image-shape":
      return <ShapeWidget label={label} value={String(current)} onChange={set} />;

    case "image-fit":
      return <FitWidget label={label} description={description} value={String(current)} onChange={set} />;

    case "video": {
      const posterField = key("posterField");
      return (
        <>
          <TextWidget
            label={label}
            description="A YouTube or Vimeo link, or the address of a video file."
            placeholder="https://www.youtube.com/watch?v=…"
            value={String(current ?? "")}
            // Some settings only apply to video files, so the kind of source is kept next to the address.
            onChange={(url) => onPatch({ [name]: url, isYouTube: isEmbeddedVideo(url) })}
          />
          <VideoUpload
            onUploaded={(url, posterUrl) =>
              onPatch({
                [name]: url,
                isYouTube: false,
                // The video's own first frame, unless the owner already chose a poster.
                ...(posterField && posterUrl && !settings[posterField] && { [posterField]: posterUrl }),
              })
            }
          />
        </>
      );
    }

    case "social-network-order":
      return (
        <SocialNetworksWidget
          label={label}
          description="Turn networks on or off and set their order."
          order={current}
          settings={settings}
          withProfiles={settings.mode === "profile"}
          onPatch={onPatch}
        />
      );

    case "map-points":
      return (
        <CardList<FormValue>
          label={label}
          addLabel="Add location"
          entries={Array.isArray(current) ? (current as FormValue[]) : []}
          title={(entry, index) => String(entry.title || `Location ${index + 1}`)}
          create={(index) => ({
            id: `point-${Date.now()}`,
            lat: 45.9432,
            lng: 24.9668,
            title: `Location ${index + 1}`,
            address: "",
          })}
          render={(entry, change) => {
            const field = (key: string, title: string, multiline = false): ReactNode => (
              <TextWidget
                label={title}
                value={String(entry[key] ?? "")}
                multiline={multiline}
                onChange={(next) => change({ ...entry, [key]: next })}
              />
            );
            const coordinate = (key: "lat" | "lng", title: string): ReactNode => (
              <TextWidget
                label={title}
                value={String(entry[key] ?? "")}
                onChange={(next) => Number.isFinite(Number(next)) && change({ ...entry, [key]: Number(next) })}
              />
            );
            return (
              <>
                {field("title", "Name")}
                {field("address", "Address")}
                <LocationSearch
                  address={String(entry.address ?? "")}
                  onFound={(lat, lng) => change({ ...entry, lat, lng })}
                />
                {coordinate("lat", "Latitude")}
                {coordinate("lng", "Longitude")}
                {field("details", "Details", true)}
                {field("hours", "Opening hours")}
                {field("phone", "Phone")}
                {field("directionsUrl", "Directions link")}
              </>
            );
          }}
          onChange={set}
        />
      );

    case "carousel-images":
      return (
        <ImagesWidget
          label={label || "Images"}
          images={Array.isArray(current) ? (current as ListedImage[]) : []}
          extras
          onChange={set}
        />
      );

    case "accordion-items":
      return (
        <CardList<FormValue>
          label={label || "Accordion Items"}
          addLabel="Add item"
          entries={Array.isArray(current) ? (current as FormValue[]) : []}
          title={(entry, index) => String(entry.title || `Item ${index + 1}`)}
          create={(index) => ({ id: `item_${Date.now()}`, title: `Item ${index + 1}`, content: "Add panel content." })}
          render={(entry, change) => (
            <>
              <TextWidget
                label="Title"
                value={String(entry.title ?? "")}
                onChange={(title) => change({ ...entry, title })}
              />
              <TextWidget
                label="Content"
                value={plain(entry.content)}
                multiline
                onChange={(content) => change({ ...entry, content })}
              />
            </>
          )}
          onChange={set}
        />
      );

    case "form-fields":
      return <FormFieldsEditor label={label || "Fields"} entries={formFieldsOf(current)} onChange={set} />;

    case "form-email-field": {
      // The form's own email fields, as they are in the side panel now: a confirmation goes to one of them.
      const emails = (Array.isArray(settings.fields) ? (settings.fields as FormValue[]) : []).filter(
        (field) => field.type === "email" && typeof field.name === "string",
      );
      return (
        <SelectWidget
          label={label}
          description={
            emails.length === 0 ? "This form has no email field yet: add one, or no confirmation is sent." : description
          }
          options={[
            { value: "", label: "The form's first email field" },
            ...emails.map((field) => ({ value: String(field.name), label: String(field.label || field.name) })),
          ]}
          value={emails.some((field) => field.name === current) ? String(current) : ""}
          onChange={set}
        />
      );
    }

    case "textarea":
    case "richtext":
    case "form-richtext":
      return (
        <TextWidget
          label={label}
          description={description}
          value={plain(current)}
          placeholder={placeholder}
          multiline
          onChange={set}
        />
      );

    default:
      return (
        <TextWidget
          label={label}
          description={description}
          value={String(current ?? "")}
          placeholder={placeholder}
          onChange={set}
        />
      );
  }
}

/**
 * A form's fields, in its steps. Without steps they are one list; with steps each step is a section of an accordion
 * holding its own questions, and opening a step shows that step on the page (the editor's `brim-editor:form-step`).
 */
function FormFieldsEditor({
  label,
  entries,
  onChange,
}: {
  label: string;
  entries: FormValue[];
  onChange: (entries: FormValue[]) => void;
}) {
  const groups = stepGroups(entries);
  const stepped = groups.some((group) => group.step);
  const [open, setOpen] = useState<number | null>(() => (stepped ? openFormStep : null));
  const newField = (index: number): FormValue => ({
    id: `field_${Date.now()}`,
    type: "text",
    name: `field_${Date.now().toString(36)}_${index + 1}`,
    label: "New field",
  });
  const newStep = (count: number): FormValue => ({ id: `step_${Date.now()}`, type: STEP, label: `Step ${count + 1}` });
  const write = (next: StepGroup[]) =>
    onChange(next.flatMap((group) => (group.step ? [group.step] : []).concat(group.fields)));
  const fieldList = (group: StepGroup, index: number) => (
    <CardList<FormValue>
      label={stepped ? "Questions" : label}
      addLabel="Add question"
      entries={group.fields}
      title={(entry, at) => String(entry.label || `Question ${at + 1}`)}
      create={newField}
      render={(entry, change) => <FieldEditor entry={entry} all={entries} change={change} />}
      onChange={(fields) => write(groups.map((other, at) => (at === index ? { ...other, fields } : other)))}
    />
  );

  /** Opens a step here and on the page; the page counts only steps that ask something. */
  function show(index: number | null): void {
    setOpen(index);
    if (index === null) return;
    openFormStep = index;
    const shown = groups.slice(0, index).filter((group) => group.fields.length > 0).length;
    window.dispatchEvent(new CustomEvent("brim-editor:form-step", { detail: shown }));
  }

  function moveStep(index: number, offset: number): void {
    const next = [...groups];
    const [group] = next.splice(index, 1);
    if (!group) return;
    next.splice(index + offset, 0, group);
    write(next);
    show(index + offset);
  }

  /** A removed step gives its questions to the step before it. */
  function removeStep(index: number): void {
    const next = groups.map((group) => ({ ...group, fields: [...group.fields] }));
    const [removed] = next.splice(index, 1);
    if (!removed) return;
    const before = next[index - 1];
    if (before) before.fields.push(...removed.fields);
    else next.splice(0, 0, { step: undefined, fields: removed.fields });
    write(next);
    setOpen(null);
  }

  if (!stepped) {
    return (
      <>
        {fieldList(groups[0] ?? { step: undefined, fields: [] }, 0)}
        <button
          type="button"
          className="brim-toolbar-btn brim-toolbar-btn--outline form-steps-add"
          onClick={() => onChange([newStep(0), ...entries])}
        >
          Ask in steps
        </button>
      </>
    );
  }

  return (
    <div className="field-group form-steps">
      <div className="card-list-header">
        <span className="field-label">Steps</span>
        <span className="card-list-count">{groups.filter((group) => group.step).length}</span>
      </div>
      {groups.map((group, index) =>
        group.step ? (
          <div key={index} className="form-step" data-open={open === index}>
            <div className="card-list-row">
              <button
                type="button"
                className="card-list-toggle"
                aria-expanded={open === index}
                onClick={() => show(open === index ? null : index)}
              >
                <span className="form-step-number">{groups.slice(0, index + 1).filter((g) => g.step).length}</span>
                <span>
                  {String(group.step.label || "Untitled step")}
                  <small className="form-step-summary">
                    {group.fields.map((field) => String(field.label || field.name)).join(" · ") || "No questions yet"}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className="card-list-btn"
                disabled={index === 0 || !groups[index - 1]?.step}
                title="Move up"
                aria-label="Move step up"
                onClick={() => moveStep(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="card-list-btn"
                disabled={index === groups.length - 1}
                title="Move down"
                aria-label="Move step down"
                onClick={() => moveStep(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="card-list-btn"
                title="Remove the step (its questions join the step before)"
                aria-label="Remove step"
                onClick={() => removeStep(index)}
              >
                ×
              </button>
            </div>
            {open === index && (
              <div className="card-list-body">
                <TextWidget
                  label="Step title"
                  value={String(group.step.label ?? "")}
                  onChange={(next) =>
                    write(
                      groups.map((other, at) =>
                        at === index && other.step ? { ...other, step: { ...other.step, label: next } } : other,
                      ),
                    )
                  }
                />
                <TextWidget
                  label="Line under the title"
                  value={String(group.step.help ?? "")}
                  onChange={(help) =>
                    write(
                      groups.map((other, at) =>
                        at === index && other.step ? { ...other, step: { ...other.step, help } } : other,
                      ),
                    )
                  }
                />
                {fieldList(group, index)}
              </div>
            )}
          </div>
        ) : (
          // Questions written before the first step are asked first, untitled.
          <div key={index} className="form-step">
            {fieldList(group, index)}
          </div>
        ),
      )}
      <button
        type="button"
        className="brim-toolbar-btn brim-toolbar-btn--outline form-steps-add"
        onClick={() => {
          const count = groups.filter((group) => group.step).length;
          write([...groups, { step: newStep(count), fields: [newField(0)] }]);
          show(groups.length);
        }}
      >
        Add step
      </button>
    </div>
  );
}

/** The step open last, kept while the sidebar is drawn again after each change. */
let openFormStep: number | null = null;

interface StepGroup {
  step: FormValue | undefined;
  fields: FormValue[];
}

/** The entries in their steps: a step entry and the questions after it, up to the next step. */
function stepGroups(entries: FormValue[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const entry of entries) {
    if (entry.type === STEP) groups.push({ step: entry, fields: [] });
    else {
      if (groups.length === 0) groups.push({ step: undefined, fields: [] });
      groups[groups.length - 1]?.fields.push(entry);
    }
  }
  return groups;
}

/** One question of a form: its kind, words, choices and rules. */
function FieldEditor({
  entry,
  all,
  change,
}: {
  entry: FormValue;
  all: FormValue[];
  change: (next: FormValue) => void;
}) {
  return (
    <>
      <SelectWidget
        label="Type"
        options={FIELD_TYPE_OPTIONS.filter((option) => option.value !== STEP)}
        value={String(entry.type)}
        onChange={(type) => change({ ...entry, type })}
      />
      <>
        <TextWidget
          label="Label"
          value={String(entry.label ?? "")}
          // A new question takes its name from its label, so answers are stored under something readable; once named,
          // it keeps the name, which its answers and the questions asked after it refer to.
          onChange={(next) =>
            change({
              ...entry,
              label: next,
              name: String(entry.name ?? "").startsWith("field_") ? fieldName(next) : entry.name,
            })
          }
        />
        {entry.type === "file" ? (
          <>
            <TextWidget
              label="Accepted files"
              description={`Any of ${Object.keys(FILE_TYPES).join(", ")}, separated by commas. Empty takes ${DEFAULT_FILE_TYPES.join(", ")}. Files are checked by their content, each up to ${fileSize(MAX_FILE_BYTES)}; only people who can read form responses can download them.`}
              value={Array.isArray(entry.accept) ? entry.accept.join(", ") : String(entry.accept ?? "")}
              placeholder={DEFAULT_FILE_TYPES.join(", ")}
              onChange={(accept) => change({ ...entry, accept })}
            />
            <CheckboxWidget
              label={`Allow several files (up to ${MAX_FILES})`}
              checked={entry.multiple === true}
              onChange={(multiple) => change({ ...entry, multiple })}
            />
          </>
        ) : (
          <TextWidget
            label="Placeholder"
            value={String(entry.placeholder ?? "")}
            onChange={(placeholder) => change({ ...entry, placeholder })}
          />
        )}
        {(entry.type === "radio" || entry.type === "checkboxes") && entry.display === "cards" ? (
          <ChoiceCards entry={entry} change={change} />
        ) : (
          (entry.type === "select" || entry.type === "radio" || entry.type === "checkboxes") && (
            <TextWidget
              label="Choices"
              description="One per line."
              multiline
              value={(Array.isArray(entry.options) ? entry.options : []).map(choiceText).join("\n")}
              onChange={(text) => {
                // A choice whose words stay keeps its icon and description.
                const before = Array.isArray(entry.options) ? entry.options : [];
                const options = text
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => {
                    const kept = before.find((option) => typeof option === "object" && choiceText(option) === line);
                    return kept ? { ...(kept as FormValue), label: line } : line;
                  });
                change({ ...entry, options });
              }}
            />
          )
        )}
        {(entry.type === "radio" || entry.type === "checkboxes") && (
          <SelectWidget
            label="Show choices as"
            options={FIELD_DISPLAY_OPTIONS}
            value={entry.display === "cards" ? "cards" : "list"}
            onChange={(display) => change({ ...entry, display })}
          />
        )}
        <TextWidget
          label="Help"
          description="A line under the question."
          value={String(entry.help ?? "")}
          onChange={(help) => change({ ...entry, help })}
        />
        <SelectWidget
          label="Width"
          options={FIELD_WIDTH_OPTIONS}
          value={entry.width === "half" ? "half" : "full"}
          onChange={(width) => change({ ...entry, width })}
        />
        <CheckboxWidget
          label="Required"
          checked={entry.required === true}
          onChange={(required) => change({ ...entry, required })}
        />
        <ShowWhenWidget entry={entry} fields={all} change={change} />
      </>
    </>
  );
}

/** The entries of a form's fields setting. */
const formFieldsOf = (value: unknown): FormValue[] => (Array.isArray(value) ? (value as FormValue[]) : []);

/** A field's choices as cards, each with its words, line, photo and icon: what a visitor sees on each card. */
function ChoiceCards({ entry, change }: { entry: FormValue; change: (next: FormValue) => void }) {
  const choices = (Array.isArray(entry.options) ? entry.options : []).map((option) =>
    typeof option === "string" ? { label: option } : (option as FormValue),
  );
  return (
    <CardList<FormValue>
      label="Choices"
      addLabel="Add choice"
      entries={choices}
      title={(choice, index) => String(choice.label || `Choice ${index + 1}`)}
      create={(index) => ({ label: `Choice ${index + 1}` })}
      render={(choice, changeChoice) => (
        <>
          <TextWidget
            label="Words"
            value={String(choice.label ?? "")}
            onChange={(label) => changeChoice({ ...choice, label })}
          />
          <TextWidget
            label="Line under"
            value={String(choice.description ?? "")}
            onChange={(description) => changeChoice({ ...choice, description })}
          />
          <ImageUploadWidget
            label="Photo"
            description="Fills the card's top."
            value={String(choice.image ?? "")}
            onChange={(image) => changeChoice({ ...choice, image })}
          />
          <TextWidget
            label="Icon"
            description="A picture's address (an SVG of the site) or an emoji."
            value={String(choice.icon ?? "")}
            onChange={(icon) => changeChoice({ ...choice, icon })}
          />
        </>
      )}
      onChange={(options) => change({ ...entry, options })}
    />
  );
}

/** "Ask only when": another field of the form with choices, and the answer of it that brings this field. */
function ShowWhenWidget({
  entry,
  fields,
  change,
}: {
  entry: FormValue;
  fields: FormValue[];
  change: (next: FormValue) => void;
}) {
  const sources = fields.filter(
    (field) => field.name !== entry.name && ["select", "radio", "checkboxes"].includes(String(field.type)),
  );
  if (sources.length === 0) return null;
  const condition = (entry.showWhen ?? {}) as { field?: string; equals?: string | string[] };
  const source = sources.find((field) => field.name === condition.field);
  const answer = Array.isArray(condition.equals) ? (condition.equals[0] ?? "") : String(condition.equals ?? "");
  const options = (Array.isArray(source?.options) ? source.options : []).map(choiceText).filter(Boolean);
  const { showWhen: _showWhen, ...rest } = entry;
  return (
    <>
      <SelectWidget
        label="Ask only when"
        options={[
          { value: "", label: "Always" },
          ...sources.map((field) => ({ value: String(field.name), label: String(field.label || field.name) })),
        ]}
        value={source ? String(source.name) : ""}
        onChange={(field) => change(field ? { ...entry, showWhen: { field, equals: options[0] ?? "" } } : rest)}
      />
      {source && (
        <SelectWidget
          label="is answered"
          options={options.map((option) => ({ value: option, label: option }))}
          value={answer}
          onChange={(equals) => change({ ...entry, showWhen: { field: source.name, equals } })}
        />
      )}
    </>
  );
}

/** BrimCMS kept some texts as HTML; they are edited as the plain text they show. */
function plain(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .trim()
    : "";
}

/**
 * The focal point is kept per preview size, in settings the schema names.
 * A size without its own value shows the one it inherits from the larger size.
 */
function ImageFocusField({
  label,
  property,
  settings,
  viewport,
  onPatch,
}: {
  label: string;
  property: SchemaProperty;
  settings: FormValue;
  viewport: "desktop" | "tablet" | "mobile";
  onPatch: (patch: FormValue) => void;
}) {
  const field = (name: string): string => String(property[name] ?? "");
  const fields = {
    desktop: [field("xField"), field("yField")],
    tablet: [field("tabletXField"), field("tabletYField")],
    mobile: [field("mobileXField"), field("mobileYField")],
  } as const;
  const inheritance = {
    desktop: ["desktop"],
    tablet: ["tablet", "desktop"],
    mobile: ["mobile", "tablet", "desktop"],
  } as const;
  const [xField, yField] = fields[viewport];
  const read = (axis: 0 | 1): number | undefined =>
    inheritance[viewport]
      .map((size) => settings[fields[size][axis]])
      .find((value): value is number => typeof value === "number");

  return (
    <FocusWidget
      label={label}
      image={String(settings[field("imageField")] ?? "")}
      x={typeof settings[xField] === "number" ? (settings[xField] as number) : undefined}
      y={typeof settings[yField] === "number" ? (settings[yField] as number) : undefined}
      onChange={(x, y) => onPatch({ [xField]: x, [yField]: y })}
      inherited={{ x: read(0), y: read(1) }}
    />
  );
}

function AlignmentWidget({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string;
  description?: string | undefined;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      <div className="brim-align" role="group" aria-label={label}>
        {options.map((option) => {
          const Icon = ALIGN_ICONS[option.value];
          return (
            <button
              key={option.value}
              type="button"
              className="brim-align__option"
              aria-pressed={option.value === value}
              aria-label={option.label}
              title={option.label}
              onClick={() => onChange(option.value)}
            >
              {Icon ? <Icon /> : option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
