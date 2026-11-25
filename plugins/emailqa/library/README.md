# Library

Shared, reusable material for every client in this workspace. When EmailQA made the workspace, it copied the starting files here. It never overwrites them, so you can edit them.

- `mjml-starter.mjml`: a starting point with the house rules built in.
- `known-noise.md`: Litmus results that come from the Klaviyo test account, not from our HTML.
- `lessons.md`: generic lessons the team adds over time. build-email reads it before writing MJML.

The plugin keeps one more file, `client-behavior.md`, in its own library folder. It says what each email client does in dark mode, with sources. It updates with the plugin, so EmailQA does not copy it here. The `find_lessons` tool searches it.

Client-specific material (logos, colours, footer details) belongs in `clients/<client>/brand/`, not here.

To share this library with colleagues, put this folder in a shared git repository or drive.
