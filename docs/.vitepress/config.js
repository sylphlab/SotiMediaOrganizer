// docs/.vitepress/config.js
import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "en-US",
  title: "MediaCurator",
  description:
    "Intelligently curate, organize, and deduplicate your digital photo and video collection.",
  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/" },
      // { text: 'API Reference', link: '/api/' } // Add later when API docs are generated
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "What is MediaCurator?", link: "/guide/introduction" },
            { text: "Installation", link: "/guide/installation" },
            { text: "Quick Start", link: "/guide/getting-started" },
          ],
        },
        {
          text: "Core Concepts",
          items: [
            { text: "Organization Format", link: "/guide/format-string" },
            { text: "Deduplication Strategy", link: "/guide/deduplication" },
          ],
        },
        // More sidebar config...
      ],
      // '/api/': [
      //   // API documentation sidebar config...
      // ]
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/shtse8/MediaCurator" },
    ],
    editLink: {
      pattern: "https://github.com/shtse8/MediaCurator/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: `Copyright © ${new Date().getFullYear()} Soti.`,
    },
  },
});
