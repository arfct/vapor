---
vapor:
  onboarding: true
  threads:
    - comment: "Docs are ephemeral."
      highlight: "99 hours"
      author: "Matt"
      color: "#E57373"
      created: "2026-02-12T11:40:00Z"
      resolved: false
    - comment: "Should we use a stronger word here?"
      highlight: "good"
      author: "Alice"
      color: "#E57373"
      created: "2026-02-01T10:00:00Z"
      resolved: false
      replies:
        - author: "Bob"
          color: "#64B5F6"
          text: "How about 'excellent'?"
          created: "2026-02-01T10:05:00Z"
    - comment: "This paragraph needs a citation."
      author: "Alice"
      color: "#E57373"
      created: "2026-02-01T11:00:00Z"
      resolved: false
---

# vapor

This is a **collaborative Markdown editor** with _real-time_ multiplayer editing, suggestions, and inline comments.

- **Share** a link to collaborate with others. _Docs auto-delete {==99 hours==}{>>Docs are ephemeral.<<} after creation._
- **Quick import.** Drag and drop an `.md` file or run a terminal command to create a new doc from an existing file.

Ready to edit? Hit the {++Start Editing++} button to clear this intro doc and begin.

## Markdown Features

You can write **bold text**, _italic text_, ~~strikethrough~~, and `inline code`. Also add [hyperlinks](https://mist.inanimate.tech). Standard Markdown syntax works except for images.

## Suggestions

Switch from **Edit Mode** to **Suggest Changes** in the sidebar (or bottom panel on mobile). Here is an example of {++added text++} that a user inserted. And here is some {--removed text--} that was marked for deletion.

## Comments

Comments can be anchored to a {==good==}{>>Should we use a stronger word here?<<} span of text using highlights, or placed inline without a selection.

Select some text and use the bubble menu to add a comment to it. {>>This paragraph needs a citation.<<} _(Comments can also be added without a highlight)_.

Click on a highlighted region or comment to open the thread panel. Threads support replies and can be resolved when the discussion is complete.

## Sharing, Exports and Roundtripping

The Share button in the header copies a link to your clipboard. Export the document as Markdown from the same menu.

The exported document includes suggested edits and comment threads. Importing the exported doc back into vapor preserves suggestions and threads.

## Try It Out

1. Switch to **Suggest Changes** mode and type some text — it appears in green
2. Select text and click **Comment** in the bubble menu
3. Hover over **Preview** to see the fully rendered markdown (or tap on mobile)
4. Click **Share** to copy a link to your clipboard
5. Go to the [homepage](https://mist.inanimate.tech) and copy the curl command to create a new doc from your terminal
