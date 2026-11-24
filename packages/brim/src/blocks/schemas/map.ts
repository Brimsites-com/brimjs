// Settings of the "map" block, carried over from BrimCMS.
// The sections list only what the embedded map can show: marker icons and map styles are left out.
import type { BlockDefinition } from "../types.ts";

export const map: BlockDefinition = {
  type: "map",
  label: "Map",
  description: "Interactive map with customizable styling",
  schema: {
    fieldsets: [{ id: "map_markers", title: "Markers", fields: ["showMarker", "points"] }],
    properties: {
      showMarker: {
        title: "Show Markers",
        type: "boolean",
        widget: "checkbox",
        default: true,
        description: "Display markers on the map",
      },
      points: {
        title: "Map Points",
        type: "array",
        widget: "map-points",
        description: "Add and manage map markers. Each point has its own location, details, and sidebar info.",
        showWhen: { showMarker: true },
      },
      markerIcon: {
        title: "Point Icon",
        type: "string",
        widget: "icon-picker",
        default: "none",
        showWhen: { showMarker: true },
        description: "Icon shown inside each marker",
      },
      mapStyle: {
        title: "Map Style",
        type: "string",
        widget: "select",
        options: [
          { value: "standard", label: "Bright / Standard" },
          { value: "light", label: "Positron Light" },
          { value: "dark", label: "Dark" },
          { value: "voyager", label: "Liberty" },
          { value: "positron", label: "Minimal Light (No Labels)" },
          { value: "darkMatter", label: "Minimal Dark (No Labels)" },
          { value: "fiord", label: "Fiord" },
          { value: "monochrome", label: "Monochrome" },
          { value: "humanitarian", label: "Humanitarian" },
          { value: "cycling", label: "Cycling" },
          { value: "terrain", label: "Terrain" },
          { value: "satellite", label: "Satellite" },
        ],
        default: "standard",
        description: "Visual style of the map tiles",
      },
    },
  },
  defaults: {
    "@type": "map",
    lat: 45.9432,
    lng: 24.9668,
    zoom: 13,
    mapStyle: "standard",
    showMarker: true,
    markerIcon: "none",
    markerTitle: "",
    points: [
      {
        id: "point-1",
        lat: 45.9432,
        lng: 24.9668,
        title: "Location",
        address: "",
        details: "",
        hours: "",
        phone: "",
        directionsUrl: "",
        imageUrl: "",
      },
    ],
  },
};
