import localFont from "next/font/local";

const manrope = localFont({
  src: [
    {
      path: "./manrope-regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./manrope-medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./manrope-semibold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./manrope-bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "./manrope-extrabold.woff2",
      weight: "800",
      style: "normal",
    },
    {
      path: "./manrope-light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "./manrope-extralight.woff2",
      weight: "200",
      style: "normal",
    },
  ],
  variable: "--font-manrope",
  display: "swap",
});

export default manrope;
