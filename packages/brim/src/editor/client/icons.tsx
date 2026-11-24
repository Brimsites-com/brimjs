import type { ReactNode } from "react";

function icon(paths: ReactNode) {
  return function Icon() {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {paths}
      </svg>
    );
  };
}

/** A gear: the settings of a page or of the selected element. */
export const SettingsIcon = icon(
  <>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const ChevronUpIcon = icon(<path d="m18 15-6-6-6 6" />);
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);
export const CloseIcon = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const ResetIcon = icon(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </>,
);
/** A curved arrow back: undo the last change. */
export const UndoIcon = icon(
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
);
/** A curved arrow forward: make the change undone again. */
export const RedoIcon = icon(
  <>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </>,
);
export const MoreIcon = icon(
  <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
);
export const PageIcon = icon(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </>,
);
export const DesktopIcon = icon(
  <>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </>,
);
export const TabletIcon = icon(
  <>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M12 18h.01" />
  </>,
);
export const MobileIcon = icon(
  <>
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M12 18h.01" />
  </>,
);
export const BoldIcon = icon(<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />);
export const ItalicIcon = icon(<path d="M19 4h-9M14 20H5M15 4 9 20" />);
export const UnderlineIcon = icon(<path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16" />);
export const LinkIcon = icon(
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </>,
);
export const StrikeIcon = icon(<path d="M16 5H10a3 3 0 0 0-2.5 4.7M4 12h16M14 12a3.5 3.5 0 0 1 0 7H7" />);
export const SubscriptIcon = icon(
  <path d="m4 6 8 10M12 6 4 16M20 20h-4c0-1.5.4-2 1.5-2.5S20 16.3 20 15.5a1.5 1.5 0 0 0-2.9-.5" />,
);
export const SuperscriptIcon = icon(
  <path d="m4 9 8 10M12 9 4 19M20 10h-4c0-1.5.4-2 1.5-2.5S20 6.3 20 5.5a1.5 1.5 0 0 0-2.9-.5" />,
);
export const TextColorIcon = icon(<path d="M6 16 12 4l6 12M8.5 12h7M4 21h16" />);
export const HighlightIcon = icon(<path d="m9 11-5 5v4h4l5-5M14 6l4 4M13 7l4-4 4 4-4 4M4 21h16" />);
export const AlignLeftIcon = icon(<path d="M4 6h16M4 12h10M4 18h13" />);
export const AlignCenterIcon = icon(<path d="M4 6h16M7 12h10M5.5 18h13" />);
export const AlignRightIcon = icon(<path d="M4 6h16M10 12h10M7 18h13" />);
export const AlignJustifyIcon = icon(<path d="M4 6h16M4 12h16M4 18h16" />);
export const BulletListIcon = icon(<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />);
export const NumberedListIcon = icon(
  <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M4 15.5c0-1 2.5-1 2.5.2 0 .8-2.5 1.8-2.5 3.3h2.5" />,
);
export const ClearFormatIcon = icon(<path d="M6 5h12M12 5 9 19M4 20 20 4" />);
export const EyeIcon = icon(
  <>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const ChevronRightIcon = icon(<path d="m9 6 6 6-6 6" />);
export const ChevronLeftIcon = icon(<path d="m15 6-6 6 6 6" />);
export const CalendarIcon = icon(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>,
);
export const ArrowLeftIcon = icon(<path d="M19 12H5M12 19l-7-7 7-7" />);
export const ArrowUpIcon = icon(<path d="M12 19V5M5 12l7-7 7 7" />);
export const ArrowDownIcon = icon(<path d="M12 5v14M19 12l-7 7-7-7" />);
export const HomeIcon = icon(
  <>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />
  </>,
);
export const FolderIcon = icon(
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
);
/** A page laid out in regions: the template every item of a type shares. */
export const TemplateIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M9 9v11" />
  </>,
);
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const PencilIcon = icon(<path d="M4 20h4L19 9l-4-4L4 16ZM14 6l4 4" />);
export const TrashIcon = icon(
  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />,
);
export const TableViewIcon = icon(<path d="M4 6h16M4 12h16M4 18h16" />);
/** Six dots: a row that can be dragged to another place. */
export const DragIcon = icon(
  <>
    <circle cx="9" cy="6" r="1.2" />
    <circle cx="15" cy="6" r="1.2" />
    <circle cx="9" cy="12" r="1.2" />
    <circle cx="15" cy="12" r="1.2" />
    <circle cx="9" cy="18" r="1.2" />
    <circle cx="15" cy="18" r="1.2" />
  </>,
);

export const GridViewIcon = icon(
  <>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
  </>,
);
