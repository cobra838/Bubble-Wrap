# Export tests

Each command reads every matching file recursively from the input folder. By default, it writes exported files into a new sibling folder and preserves the input folder hierarchy. A `report.json` is added to that output folder.

```bash
npm run test:yaml -- "C:\path\to\yaml" --game botw --auto-split on
npm run test:yaml -- "C:\path\to\yaml" --game totk --auto-split on
npm run test:msyt -- "C:\path\to\msyt"
npm run test:bcml -- "C:\path\to\bcml"
npm run test:msyt-to-yaml -- "C:\path\to\msyt"
npm run test:yaml-to-msyt -- "C:\path\to\yaml"
```

An optional second path chooses the output folder explicitly:

```bash
npm run test:yaml -- "C:\path\to\yaml" "C:\path\to\yaml-output" --game botw --auto-split on
```

`--game botw` is the default. MSYT and BCML tests support BotW only. The tester does not infer the game from `hasATR1`.

`--auto-split off` is the default. Use `--auto-split on` for a dedicated auto-split run.

The YAML, MSYT, and BCML tests compare the exported result to the imported file. The conversion tests only require a successful import and export, because their output format is intentionally different.
