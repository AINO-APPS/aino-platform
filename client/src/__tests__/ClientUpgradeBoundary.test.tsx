import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ClientUpgradeBoundary from "../components/common/ClientUpgradeBoundary";
import { inspectClientUpgrade } from "../api/clientUpgrade";

afterEach(() => { cleanup(); delete window.electronAPI; });
const requirement = { code: "CLIENT_UPGRADE_REQUIRED", client: "web", min_version: "3.0.80", current_version: "3.0.79" };

test("a server upgrade replaces the entire web application with a blocking reload action", async () => {
    const reload = vi.fn();
    render(<ClientUpgradeBoundary reload={reload}><button>Normal application</button></ClientUpgradeBoundary>);
    expect(screen.getByText("Normal application")).toBeInTheDocument();
    await act(() => inspectClientUpgrade({ status: 426, data: requirement }));
    expect(screen.queryByText("Normal application")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A newer AINO is ready" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dismiss|later/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload AINO" }));
    expect(reload).toHaveBeenCalledOnce();
});

test("desktop automatically uses the existing updater and offers restart only after download", async () => {
    let downloaded: (() => void) | undefined;
    const checkForUpdate = vi.fn(async () => ({ available: true }));
    const installUpdate = vi.fn();
    const unsubscribe = vi.fn();
    window.electronAPI = {
        checkForUpdate, installUpdate,
        onUpdateDownloaded: (callback: () => void) => { downloaded = callback; return unsubscribe; },
        onUpdateAvailable: () => unsubscribe, onUpdateError: () => unsubscribe, onUpdateReminder: () => unsubscribe,
    } as unknown as ElectronAPI;
    const view = render(<ClientUpgradeBoundary><p>Normal application</p></ClientUpgradeBoundary>);
    await act(() => inspectClientUpgrade({ status: 426, data: requirement }));
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: /restart/i })).not.toBeInTheDocument();
    await act(async () => downloaded?.());
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(installUpdate).toHaveBeenCalledOnce();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
});
