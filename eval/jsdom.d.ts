// Minimal typings for the parts of jsdom the eval harness uses (@types/jsdom is not installed; package.json is frozen).
declare module 'jsdom' {
  export class VirtualConsole {
    constructor()
    on(event: string, listener: (...args: unknown[]) => void): this
  }
  export interface ConstructorOptions {
    url?: string
    contentType?: string
    virtualConsole?: VirtualConsole
  }
  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions)
    readonly window: Window & typeof globalThis
  }
}
