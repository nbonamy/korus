---
name: korus-imagegen
description: Generate images, show them inline in your response, and optionally save them to a chosen location.
---

# Image generation

Use `generate-image` with a prompt describing the requested image. Inspect the
result before presenting it.

## Show the result

Showing the image inline is good practice: the user can see the result directly.
Embed it in your response using Markdown on its own line, outside a code fence:

```markdown
![Blue flower](</absolute/path/to/blue-flower.png>)
```

Use the actual absolute path returned by the tool. The leading `!` embeds the
image; angle brackets support paths containing spaces. A file link or a statement
that you read the image does not show it to the user.

## Save elsewhere when needed

The image is already saved at the returned path. Displaying it does not require
another copy. If the user requests a destination or the project needs the image
as an asset, copy it there and use that final path in your response. Preserve
existing files unless replacement was requested, and report where you saved it.
