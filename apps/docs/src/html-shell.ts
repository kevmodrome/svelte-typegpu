const criticalShellStyle =
  'html{min-height:100%;color-scheme:dark;background:#080d0f;}body{min-height:100%;margin:0;background:#080d0f;color:#eef7f5;}';

export const htmlShell = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${criticalShellStyle}</style>
    {{mochi.head}} {{mochi.css}}
  </head>
  <body>
    {{mochi.body}} {{mochi.script}}
  </body>
</html>`;
