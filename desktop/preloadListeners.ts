import type { IpcRendererEvent } from "electron";
import type { ListenerContract, Unsubscribe } from "./ipc-contract";

export interface ListenerTransport {
  on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): unknown;
  removeListener(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): unknown;
}

export function subscribe<C extends keyof ListenerContract, T = ListenerContract[C][0]>(
  transport: ListenerTransport,
  channel: C,
  callback: (value: T) => void,
  transform?: (...args: ListenerContract[C]) => T,
): Unsubscribe {
  const handler = (_event: IpcRendererEvent, ...rawArgs: unknown[]) => {
    const args = rawArgs as ListenerContract[C];
    callback(transform ? transform(...args) : (args[0] as T));
  };
  transport.on(channel, handler);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    transport.removeListener(channel, handler);
  };
}
