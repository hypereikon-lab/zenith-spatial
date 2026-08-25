export const DEFAULT_ACTIVE_PLATE_INDEX = 0;

export const DEFAULT_PLATE_PLACEMENTS = [
  {
    azimuth: -8.898463670050432,
    radius: 0.5257978446693106,
    scale: 0.6812733176437584,
    spin: 16.30072568238097,
    opacity: 1,
    flipX: false,
    flipY: false,
  },
  {
    azimuth: 84.61687012594189,
    radius: 0.6472162968855301,
    scale: 1.55,
    spin: -22.238040365345114,
    opacity: 1,
    flipX: false,
    flipY: false,
  },
  {
    azimuth: -114.37962915281707,
    radius: 0.6394208138109876,
    scale: 2.17,
    spin: 0.8718582179355963,
    opacity: 1,
    flipX: false,
    flipY: false,
  },
] as const;

export const DEFAULT_PLATE_REFERENCES = [
  {
    name: "plate-01.png",
    url: "/default-plates/plate-01.png",
    width: 1024,
    height: 1024,
  },
  {
    name: "plate-02.png",
    url: "/default-plates/plate-02.png",
    width: 1424,
    height: 832,
  },
  {
    name: "plate-03.png",
    url: "/default-plates/plate-03.png",
    width: 1424,
    height: 832,
  },
] as const;
