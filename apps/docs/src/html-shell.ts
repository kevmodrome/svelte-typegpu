import { viewTransitionHeadScript } from './view-transitions';

const criticalShellStyle =
  'html{color-scheme:dark;background:#080d0f;}body{margin:0;background:#080d0f;color:#eef7f5;}';

export const htmlShell = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${criticalShellStyle}</style>
    <script>${viewTransitionHeadScript}</script>
    {{mochi.head}} {{mochi.css}}
  </head>
  <body>
    {{mochi.body}} {{mochi.script}}
  </body>
</html>`;
