# Organization Format String

The `--format` option is a powerful feature that allows you to precisely control the directory structure and filenames of your organized media within the destination directory.

You define a template string containing **placeholders** enclosed in curly braces `{}`. MediaCurator replaces these placeholders with actual metadata or file information during processing. You can combine these placeholders with static text (like `/`, `-`, or `_`) and directory separators (`/`) to build your desired output path relative to the destination directory.

## Available Placeholders

Here is a list of the available placeholders:

### Date Placeholders

Date placeholders allow you to organize files based on timestamps. You **must** specify the source of the date using a prefix:

- `I.` : Use the **Image Date** (extracted from EXIF metadata, typically the 'Date Taken'). Available only for images with valid EXIF date information.
- `F.` : Use the **File Creation Date** (obtained from the file system). Available for all files.
- `D.` : Use the **Default Mixed Date**. This is the recommended option for general use. It prioritizes the Image Date (`I.`) if available and valid, otherwise it falls back to the File Creation Date (`F.`).

Replace the `?` in the examples below with `I`, `F`, or `D`.

- **Year:** `{?.YYYY}` (e.g., `2023`), `{?.YY}` (e.g., `23`)
- **Month:** `{?.MMMM}` (Full name, e.g., `January`), `{?.MMM}` (Abbreviated name, e.g., `Jan`), `{?.MM}` (2-digit number, e.g., `01`), `{?.M}` (1 or 2-digit number, e.g., `1`)
- **Day:** `{?.DD}` (2-digit day of month, e.g., `05`), `{?.D}` (1 or 2-digit day of month, e.g., `5`)
- **Weekday:** `{?.DDDD}` (Full name, e.g., `Sunday`), `{?.DDD}` (Abbreviated name, e.g., `Sun`)
- **Hour:** `{?.HH}` (24-hour, 2-digit, e.g., `14`), `{?.H}` (24-hour, 1 or 2-digit, e.g., `14`), `{?.hh}` (12-hour, 2-digit, e.g., `02`), `{?.h}` (12-hour, 1 or 2-digit, e.g., `2`)
- **Minute:** `{?.mm}` (2-digit, e.g., `08`), `{?.m}` (1 or 2-digit, e.g., `8`)
- **Second:** `{?.ss}` (2-digit, e.g., `09`), `{?.s}` (1 or 2-digit, e.g., `9`)
- **AM/PM:** `{?.a}` (lowercase `am`/`pm`), `{?.A}` (uppercase `AM`/`PM`)
- **Week:** `{?.WW}` (Week number of the year, 01-53, e.g., `01`)

### Filename Placeholders

These placeholders relate to the original file's name and extension.

- `{NAME}`: Original filename without the extension.
- `{NAME.L}`: Original filename without the extension, converted to lowercase.
- `{NAME.U}`: Original filename without the extension, converted to uppercase.
- `{EXT}`: Original file extension, **including** the leading dot (e.g., `.jpg`, `.mp4`).

### Metadata Placeholders

These placeholders use metadata extracted from the file. If the metadata is not available, the placeholder will be replaced with an empty string (unless otherwise noted).

- `{GEO}`: GPS coordinates in `latitude_longitude` format (e.g., `34.0522_-118.2437`). Empty if no GPS data is found.
- `{CAM}`: Camera model name (e.g., `iPhone 14 Pro`, `Canon EOS R5`). Empty if not found.
- `{TYPE}`: The type of media, either `Image` or `Video`.

### Conditional Placeholders

These placeholders provide a simple text value based on the presence or absence of certain metadata.

- `{HAS.GEO}`: Outputs `GeoTagged` if GPS data exists, otherwise `NoGeo`.
- `{HAS.CAM}`: Outputs `WithCamera` if camera model data exists, otherwise `NoCamera`.
- `{HAS.DATE}`: Outputs `Dated` if EXIF Image Date exists, otherwise `NoDate`.

### Other Placeholders

- `{RND}`: A random 8-character hexadecimal string (e.g., `a1b2c3d4`). This is extremely useful for adding to filenames to prevent potential collisions if multiple files might otherwise end up with the exact same name in the same target directory.

## Examples

Let's see how these can be combined:

- **Standard Year/Month/Day Structure:**

  ```
  --format "{D.YYYY}/{D.MM}/{D.DD}/{NAME}{EXT}"
  ```

  _Result Example: `2023/04/15/MyPhoto.jpg`_

- **Group by Camera Model, then Year, Add Random Suffix:**

  ```
  --format "{HAS.CAM}/{CAM}/{D.YYYY}/{NAME}_{RND}{EXT}"
  ```

  _Result Examples:_

  - `WithCamera/Canon EOS R5/2023/IMG_1234_a1b2c3d4.jpg`
  - `NoCamera/Unknown/2023/VideoClip_b4c5d6e7.mp4` (If camera model is missing, `{CAM}` becomes empty, but `{HAS.CAM}` still works)

- **Include Type and Full Date in Filename:**

  ```
  --format "{TYPE}/{D.YYYY}-{D.MM}-{D.DD}_{NAME}{EXT}"
  ```

  _Result Example: `Image/2023-04-15_MyPhoto.jpg`_

- **Organize by Geotag Status and Year/Month:**
  ```
  --format "{HAS.GEO}/{D.YYYY}/{D.MMMM}/{NAME}{EXT}"
  ```
  _Result Examples:_
  - `GeoTagged/2024/January/VacationPic.jpg`
  - `NoGeo/2024/February/IndoorShot.png`\*

Experiment with different combinations to achieve the organization structure that best suits your needs! Remember to use the `--debug` option first to preview the results without moving files.
