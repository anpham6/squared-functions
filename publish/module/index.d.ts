import type { ModuleConstructor } from '../types/lib';

declare const Module: ModuleConstructor;

export = Module;
export as namespace Module;