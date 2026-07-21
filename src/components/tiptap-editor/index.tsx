import type {
  Extensions,
  JSONContent,
  Editor as TiptapEditor,
} from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { normalizeLinkHref } from "@/lib/links/normalize-link-href";
import { cn } from "@/lib/utils";
import type { FormulaModalPayload } from "./formula-modal-store";
import {
  addFormulaModalOpener,
  removeFormulaModalOpener,
  setActiveFormulaModalOpenerKey,
} from "./formula-modal-store";
import EditorToolbar, { type EditorViewMode } from "./ui/editor-toolbar";
import type { FormulaMode } from "./ui/formula-modal";
import { FormulaModal } from "./ui/formula-modal";
import type { ModalType } from "./ui/insert-modal";
import InsertModal from "./ui/insert-modal";
import { TableBubbleMenu } from "./ui/table-bubble-menu";

interface EditorProps {
  content?: JSONContent | string;
  onChange?: (json: JSONContent) => void;
  onCreated?: (editor: TiptapEditor) => void;
  extensions: Extensions;
  editable?: boolean;
  className?: string;
  contentClassName?: string;
}

export const Editor = memo(function Editor({
  content,
  onChange,
  onCreated,
  extensions,
  editable = true,
  className,
  contentClassName,
}: EditorProps) {
  const formulaOpenerKeyRef = useRef(Symbol("formula-modal-opener"));
  const [modalOpen, setModalOpen] = useState<ModalType>(null);
  const [modalInitialUrl, setModalInitialUrl] = useState("");
  const [formulaModalOpen, setFormulaModalOpen] = useState(false);
  const [formulaPayload, setFormulaPayload] = useState<{
    mode: FormulaMode;
    initialLatex: string;
    editContext: { pos: number; type: FormulaMode } | null;
  }>({ mode: "inline", initialLatex: "", editContext: null });

  // 视图模式：edit=编辑(原富文本) / preview=预览 / compare=左右对比
  const [viewMode, setViewMode] = useState<EditorViewMode>("edit");
  const [previewHtml, setPreviewHtml] = useState("");
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  // Markdown 粘贴开关：默认关闭，开启后粘贴纯文本才按 Markdown 解析
  const [markdownPaste, setMarkdownPaste] = useState(false);
  const markdownPasteRef = useRef(markdownPaste);
  markdownPasteRef.current = markdownPaste;

  const editor = useEditor({
    extensions,
    content,
    editable,
    onCreate: ({ editor: currentEditor }) => {
      onCreated?.(currentEditor);
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.(currentEditor.getJSON());
      if (viewModeRef.current !== "edit") {
        setPreviewHtml(currentEditor.getHTML());
      }
    },
    editorProps: {
      attributes: {
        class: cn(
          "max-w-none focus:outline-none text-lg leading-relaxed min-h-[500px]",
          !editable && "min-h-0 text-base leading-7",
          contentClassName,
        ),
      },
      // 粘贴纯文本时，先尝试按 Markdown 解析（图床图片 ![](url) 等会渲染成节点）；
      // 解析失败或普通文本则返回 null，回退 Tiptap 默认粘贴行为，不影响原功能。
      clipboardTextParser: (text, context) => {
        if (!markdownPasteRef.current) return null;
        try {
          const md = (
            editor as unknown as {
              markdown?: { parse: (md: string) => JSONContent };
            }
          )?.markdown;
          const json = md?.parse(text);
          if (json && Array.isArray(json.content) && json.content.length > 0) {
            return ProseMirrorNode.fromJSON(context.schema, json).content;
          }
        } catch {
          // 非 Markdown 内容：忽略，走默认粘贴逻辑
        }
        return null;
      },
    },
    immediatelyRender: false,
  });

  const openLinkModal = useCallback(() => {
    const previousUrl = editor?.getAttributes("link").href;
    setModalInitialUrl(previousUrl || "");
    setModalOpen("LINK");
  }, [editor]);

  const openImageModal = useCallback(() => {
    setModalInitialUrl("");
    setModalOpen("IMAGE");
  }, []);

  const openFormulaModal = useCallback((mode: FormulaMode) => {
    setFormulaPayload({
      mode,
      initialLatex: mode === "inline" ? "x^2+y^2=z^2" : "E = mc^2",
      editContext: null,
    });
    setFormulaModalOpen(true);
  }, []);

  const handleViewModeChange = useCallback(
    (mode: EditorViewMode) => {
      if (mode !== "edit" && editor) {
        setPreviewHtml(editor.getHTML());
      }
      setViewMode(mode);
    },
    [editor],
  );

  useEffect(() => {
    if (!editable) return;

    const opener = (payload: FormulaModalPayload) => {
      setFormulaPayload({
        mode: payload.type,
        initialLatex: payload.latex,
        editContext: { pos: payload.pos, type: payload.type },
      });
      setFormulaModalOpen(true);
    };
    addFormulaModalOpener(formulaOpenerKeyRef.current, opener);
    return () => removeFormulaModalOpener(formulaOpenerKeyRef.current);
  }, [editable]);

  const markActiveFormulaOpener = useCallback(() => {
    if (!editable) return;
    setActiveFormulaModalOpenerKey(formulaOpenerKeyRef.current);
  }, [editable]);

  const handleFormulaApply = useCallback(
    (
      latex: string,
      mode: FormulaMode,
      editContext: { pos: number; type: FormulaMode } | null,
    ) => {
      if (!editor) return;
      if (editContext && editContext.type !== mode) {
        const chain = editor
          .chain()
          .setNodeSelection(editContext.pos)
          .deleteSelection();
        if (mode === "inline") {
          chain.insertInlineMath({ latex }).focus().run();
        } else {
          chain.insertBlockMath({ latex }).focus().run();
        }
      } else if (editContext) {
        if (editContext.type === "inline") {
          editor
            .chain()
            .setNodeSelection(editContext.pos)
            .updateInlineMath({ latex })
            .focus()
            .run();
        } else {
          editor
            .chain()
            .setNodeSelection(editContext.pos)
            .updateBlockMath({ latex })
            .focus()
            .run();
        }
      } else {
        if (mode === "inline") {
          editor.chain().focus().insertInlineMath({ latex }).run();
        } else {
          editor.chain().focus().insertBlockMath({ latex }).run();
        }
      }
      setFormulaModalOpen(false);
    },
    [editor],
  );

  const handleModalSubmit = (
    url: string,
    attrs?: { width?: number; height?: number },
  ) => {
    if (modalOpen === "LINK") {
      if (url === "") {
        editor?.chain().focus().extendMarkRange("link").unsetLink().run();
      } else {
        const href = normalizeLinkHref(url);
        editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
      }
    } else if (modalOpen === "IMAGE") {
      if (url) {
        editor
          ?.chain()
          .focus()
          .setImage({ src: url, ...attrs })
          .run();
      }
    }

    setModalOpen(null);
  };

  return (
    <div className={cn("relative flex flex-col group", className)}>
      {editable && (
        <EditorToolbar
          editor={editor}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          markdownPaste={markdownPaste}
          onMarkdownPasteChange={setMarkdownPaste}
          onLinkClick={openLinkModal}
          onImageClick={openImageModal}
          onFormulaInlineClick={() => openFormulaModal("inline")}
          onFormulaBlockClick={() => openFormulaModal("block")}
        />
      )}

      {editable && <TableBubbleMenu editor={editor} />}

      <div
        className="relative min-h-125"
        onMouseDownCapture={markActiveFormulaOpener}
        onFocusCapture={markActiveFormulaOpener}
      >
        {viewMode === "edit" && <EditorContent editor={editor} />}

        {viewMode === "preview" && (
          <div
            className="max-w-none text-lg leading-relaxed min-h-[500px] p-4 rounded-md bg-muted/20"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}

        {viewMode === "compare" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[500px]">
            <div className="md:border-r md:border-border/50 md:pr-4">
              <EditorContent editor={editor} />
            </div>
            <div
              className="max-w-none text-lg leading-relaxed md:pl-2 p-4 rounded-md bg-muted/20"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
      </div>

      {editable && (
        <InsertModal
          type={modalOpen}
          initialUrl={modalInitialUrl}
          onClose={() => setModalOpen(null)}
          onSubmit={handleModalSubmit}
        />
      )}

      {editable && (
        <FormulaModal
          isOpen={formulaModalOpen}
          mode={formulaPayload.mode}
          initialLatex={formulaPayload.initialLatex}
          editContext={formulaPayload.editContext}
          onClose={() => setFormulaModalOpen(false)}
          onApply={handleFormulaApply}
        />
      )}
    </div>
  );
});
