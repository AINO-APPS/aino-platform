import { ChevronDown as MaterialChevronDown, Search as MaterialSearch, Edit as MaterialEdit, Plus as MaterialPlus } from "../../../constants/icons";
/* eslint-disable @typescript-eslint/no-explicit-any */
/* PageSwitcher — inline header dropdown for picking/renaming pages */
import React from "react";
import { Pin } from "../../../constants/icons";
import { formatDate } from "../notesUtils";
import s from "./PageSwitcher.module.css";

interface PageSwitcherProps {
    activePage?: any;
    menuOpen: boolean;
    setMenuOpen: (fn: any) => void;
    menuRef: React.RefObject<any>;
    dropdownPages: any[];
    dropdownSearch: string;
    setDropdownSearch: (v: string) => void;
    activePageId: any;
    renamingId: any;
    renameValue: string;
    setRenameValue: (v: string) => void;
    renameRef: React.RefObject<any>;
    onSelectPage: (id: any) => void;
    onStartRename: (id: any, title: any) => void;
    onCommitRename: (id: any) => void;
    onCancelRename: () => void;
    onNewPage: () => void;
}

export default function PageSwitcher({
    activePage,
    menuOpen, setMenuOpen,
    menuRef,
    dropdownPages,
    dropdownSearch, setDropdownSearch,
    activePageId,
    renamingId, renameValue, setRenameValue, renameRef,
    onSelectPage,
    onStartRename,
    onCommitRename,
    onCancelRename,
    onNewPage,
}: PageSwitcherProps) {
    return (
        <div className={s.switcher} ref={menuRef}>
            <button
                className={s.switcherBtn}
                onClick={() => setMenuOpen((o: boolean) => !o)}
                title="Switch page"
            >
                {activePage?.pinned && <span className={s.pinSmall}><Pin size={11} /></span>}
                <span className={s.switcherName}>{activePage?.title || "Untitled"}</span>
                <MaterialChevronDown size={10} className={`${s.switcherChevron} ${menuOpen ? s.switcherChevronOpen : ""}`} />
            </button>

            {menuOpen && (
                <div className={s.menu}>
                    {/* Search */}
                    <div className={s.menuSearchWrap}>
                        <MaterialSearch size={13} />
                        <input
                            className={s.menuSearchInput}
                            placeholder="Search pages…"
                            value={dropdownSearch}
                            onChange={e => setDropdownSearch(e.target.value)}
                            autoFocus
                        />
                    </div>

                    {/* Page list */}
                    <div className={s.menuList}>
                        {dropdownPages.length === 0 && (
                            <div className={s.menuEmpty}>No pages found</div>
                        )}
                        {dropdownPages.map(page => (
                            <div
                                key={page.id}
                                className={`${s.menuItem} ${page.id === activePageId ? s.menuItemActive : ""}`}
                            >
                                {renamingId === page.id ? (
                                    <input
                                        ref={renameRef}
                                        className={s.renameInput}
                                        value={renameValue}
                                        onChange={e => setRenameValue(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === "Enter") onCommitRename(page.id);
                                            if (e.key === "Escape") onCancelRename();
                                        }}
                                        onBlur={() => onCommitRename(page.id)}
                                        onClick={e => e.stopPropagation()}
                                    />
                                ) : (
                                    <button
                                        className={s.menuItemBtn}
                                        onClick={() => { onSelectPage(page.id); setMenuOpen(false); }}
                                    >
                                        {page.pinned && <span className={s.pinSmall}><Pin size={11} /></span>}
                                        <span className={s.menuItemName}>{page.title || "Untitled"}</span>
                                        <span className={s.menuItemDate}>{formatDate(page.updatedAt)}</span>
                                    </button>
                                )}
                                {renamingId !== page.id && (
                                    <button
                                        className={s.menuItemRename}
                                        onClick={e => { e.stopPropagation(); onStartRename(page.id, page.title); }}
                                        title="Rename"
                                    >
                                        <MaterialEdit size={12} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* New page */}
                    <button className={s.menuNewBtn} onClick={() => { onNewPage(); setMenuOpen(false); }}>
                        <MaterialPlus size={14} />
                        New page
                    </button>
                </div>
            )}
        </div>
    );
}