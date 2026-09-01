import { useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "~/components/ui/menu";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import Icon from "~/components/Icon";
import { cn } from "~/lib/cn";

function useEditorTick() {
  const { editorInstance: editor } = useDocument();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((t) => t + 1);
    editor.on("transaction", bump);
    editor.on("focus", bump);
    editor.on("blur", bump);
    return () => {
      editor.off("transaction", bump);
      editor.off("focus", bump);
      editor.off("blur", bump);
    };
  }, [editor]);
  return editor;
}

const triggerClass =
  "flex h-full cursor-pointer items-center px-2.5 transition-colors hover:bg-border";

/**
 * The formatting toolbar, imported from the notes app: Format, Lists, and
 * Insert menus in the document header. The group dims while the editor is
 * unfocused and restores on hover, focus, or an open menu.
 */
export default function FormatToolbar() {
  const editor = useEditorTick();
  const [openMenus, setOpenMenus] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");

  if (!editor) return null;

  const dimmed = !editor.isFocused && !hovered && openMenus === 0;
  const onOpenChange = (open: boolean) => setOpenMenus((n) => (open ? n + 1 : Math.max(0, n - 1)));

  const markButton = (mark: string, icon: string, label: string, toggle: () => void) => (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-9 w-9", editor.isActive(mark) && "bg-accent")}
      onClick={toggle}
      title={label}
      aria-label={label}
    >
      <Icon name={icon} />
    </Button>
  );

  const blockItem = (
    icon: string,
    label: string,
    active: boolean,
    run: () => void,
  ) => (
    <MenuItem className="gap-2" onClick={run}>
      <Icon name={icon} />
      <span className={active ? "font-semibold" : undefined}>{label}</span>
      {active && <span className="ml-auto pl-3 text-muted">{"✓"}</span>}
    </MenuItem>
  );

  const insertLink = () => {
    const href = linkUrl.trim();
    if (!href) return;
    const { from, to } = editor.state.selection;
    if (from !== to) {
      editor.chain().focus().setLink({ href }).run();
    } else {
      const label = linkTitle.trim() || href;
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] })
        .run();
    }
    setShowLinkDialog(false);
    setLinkUrl("");
    setLinkTitle("");
  };

  return (
    <div
      className={cn(
        "flex h-full items-center transition-opacity duration-200",
        dimmed && "opacity-40",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Menu onOpenChange={onOpenChange}>
        <MenuTrigger>
          <button className={triggerClass} title="Formatting" aria-label="Formatting">
            <Icon name="format_size" />
          </button>
        </MenuTrigger>
        <MenuContent>
          <div className="flex items-center gap-0.5 px-1 py-1">
            {markButton("bold", "format_bold", "Bold", () => editor.chain().focus().toggleBold().run())}
            {markButton("italic", "format_italic", "Italic", () => editor.chain().focus().toggleItalic().run())}
            {markButton("strike", "strikethrough_s", "Strikethrough", () => editor.chain().focus().toggleStrike().run())}
            {markButton("code", "code", "Inline code", () => editor.chain().focus().toggleCode().run())}
          </div>
          <MenuSeparator />
          {blockItem("format_paragraph", "Body text", editor.isActive("paragraph"), () =>
            editor.chain().focus().setParagraph().run())}
          {blockItem("format_h1", "Heading 1", editor.isActive("heading", { level: 1 }), () =>
            editor.chain().focus().toggleHeading({ level: 1 }).run())}
          {blockItem("format_h2", "Heading 2", editor.isActive("heading", { level: 2 }), () =>
            editor.chain().focus().toggleHeading({ level: 2 }).run())}
          {blockItem("format_h3", "Heading 3", editor.isActive("heading", { level: 3 }), () =>
            editor.chain().focus().toggleHeading({ level: 3 }).run())}
        </MenuContent>
      </Menu>

      <Menu onOpenChange={onOpenChange}>
        <MenuTrigger>
          <button className={triggerClass} title="Lists" aria-label="Lists">
            <Icon name="format_list_bulleted" />
          </button>
        </MenuTrigger>
        <MenuContent>
          {blockItem("format_list_bulleted", "Bullet list", editor.isActive("bulletList"), () =>
            editor.chain().focus().toggleBulletList().run())}
          {blockItem("format_list_numbered", "Numbered list", editor.isActive("orderedList"), () =>
            editor.chain().focus().toggleOrderedList().run())}
          {blockItem("format_quote", "Quote", editor.isActive("blockquote"), () =>
            editor.chain().focus().toggleBlockquote().run())}
        </MenuContent>
      </Menu>

      <Menu onOpenChange={onOpenChange}>
        <MenuTrigger>
          <button className={triggerClass} title="Insert" aria-label="Insert">
            <Icon name="add_box" />
          </button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem
            className="gap-2"
            onClick={() => {
              setLinkUrl("");
              setLinkTitle("");
              setShowLinkDialog(true);
            }}
          >
            <Icon name="link" />
            Link…
          </MenuItem>
          <MenuItem className="gap-2" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            <Icon name="horizontal_rule" />
            Divider
          </MenuItem>
          <MenuItem className="gap-2" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            <Icon name="code" />
            Code block
          </MenuItem>
        </MenuContent>
      </Menu>

      {showLinkDialog && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowLinkDialog(false)} />
          <div
            role="dialog"
            aria-label="Insert link"
            className="fixed left-1/2 top-16 z-50 w-80 -translate-x-1/2 border border-border bg-paper p-4 shadow-lg"
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowLinkDialog(false);
              if (e.key === "Enter") insertLink();
            }}
          >
            <div className="space-y-2">
              <Input
                autoFocus
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://…"
              />
              {editor.state.selection.empty && (
                <Input
                  type="text"
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="Link text (optional)"
                />
              )}
              <Button size="sm" className="w-full" onClick={insertLink}>
                Insert link
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
