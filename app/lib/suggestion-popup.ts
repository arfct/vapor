import type { ComponentType } from "react";
import { ReactRenderer } from "@tiptap/react";
import type { PluginKey } from "@tiptap/pm/state";
import { exitSuggestion, type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import type { SuggestionListHandle } from "~/components/SuggestionList";

/** Props every popup component receives from the plugin. */
export interface PopupProps<I> {
  items: I[];
  query: string;
  command: (item: I) => void;
}

/**
 * The `render()` half of a Suggestion config, the standard TipTap shape:
 * a React component mounted through `ReactRenderer`, positioned and kept
 * anchored to the caret by the plugin's own floating-ui `mount`, and driven
 * by keyboard through the component's imperative handle. Escape closes the
 * popup and leaves the typed text alone.
 */
export function suggestionRender<I>(
  Component: ComponentType<PopupProps<I> & { ref?: React.Ref<SuggestionListHandle> }>,
  pluginKey: PluginKey,
): NonNullable<SuggestionOptions<I, I>["render"]> {
  return () => {
    let component: ReactRenderer<SuggestionListHandle, PopupProps<I>> | null = null;
    let unmount: (() => void) | null = null;

    const popupProps = (props: SuggestionProps<I, I>): PopupProps<I> => ({
      items: props.items,
      query: props.query,
      command: props.command,
    });

    return {
      onStart(props) {
        component = new ReactRenderer<SuggestionListHandle, PopupProps<I>>(Component, {
          props: popupProps(props),
          editor: props.editor,
        });
        unmount = props.mount(component.element as HTMLElement);
      },
      onUpdate(props) {
        component?.updateProps(popupProps(props));
      },
      onKeyDown({ event, view }) {
        if (event.key === "Escape") {
          exitSuggestion(view, pluginKey);
          return true;
        }
        return component?.ref?.onKeyDown(event) ?? false;
      },
      onExit() {
        unmount?.();
        component?.destroy();
        component = null;
        unmount = null;
      },
    };
  };
}
