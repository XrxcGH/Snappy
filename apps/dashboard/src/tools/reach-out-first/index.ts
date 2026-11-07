import type { ToolDescriptor } from "../types.ts";
import { copy } from "./copy.ts";
import { meta, view } from "./view.ts";

export const descriptor: ToolDescriptor = { ...meta, title: copy.title, oneLiner: copy.oneLiner, view };
