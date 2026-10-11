import { Check as MaterialCheck, Minus as MaterialMinus, Clock as MaterialClock, Circle as MaterialCircle, ChevronDown as MaterialChevronDown, Edit as MaterialEdit, Trash2 as MaterialTrash2, Sun as MaterialSun, Moon as MaterialMoon, RefreshCw as MaterialRefreshCw, LogOut as MaterialLogOut } from "../../constants/icons";
import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../../ThemeContext";
import { useWorkState } from "../../WorkStateContext";
import { useStatus } from "../../status/useStatus";
import { clockOut as apiClockOut, switchRealm } from "../../api/workforce";
import { uploadAvatar, removeAvatar } from "../../api/organization";
import { baseURL } from "../../api/client";
import { Camera, Building2, House, Bell, ScanFace, Repeat2, ShieldCheck, FileText } from "../../constants/icons";
import { currentRealm } from "../../AuthContext";
import EditProfileModal from "../profile/EditProfileModal";
import NotificationSoundsModal from "../profile/NotificationSoundsModal";
import ConfirmDialog from "../common/ConfirmDialog";
import StatusPicker from "../common/StatusPicker";
import { useClickOutside } from "../../hooks/useClickOutside";
import s from "./Navbar.module.css";

type Glyph = "check" | "minus" | "clock" | "ring" | "dot";

interface StatusMeta {
    label: string;
    glyph: Glyph;
}

export default function ProfileMenu() {
    const { user, logout, updateUser } = useAuth() as any;
    const { theme, toggleTheme } = useTheme() as any;
    const { workState, workMode } = useWorkState() as any;
    const { effective: myStatus } = useStatus();

    const [profileOpen, setProfileOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [soundsModalOpen, setSoundsModalOpen] = useState(false);
    const [signoutConfirming, setSignoutConfirming] = useState(false);
    const [removeAvatarConfirming, setRemoveAvatarConfirming] = useState(false);
    const [switchingRealm, setSwitchingRealm] = useState(false);

    const profileRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useClickOutside(profileRef, () => setProfileOpen(false));

    const renderBaseURL = baseURL.endsWith("/api") ? baseURL.slice(0, -4) : baseURL;
    const avatarUrl = user?.avatar
        ? user.avatar.startsWith("http")
            ? user.avatar
            : `${renderBaseURL}${user.avatar}`
        : null;
    const initials = user?.full_name
        ? user.full_name
              .split(" ")
              .map((w: string) => w[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)
        : "?";

    // `brb` (user-picked "Away") and `away` (server-derived from idle) are
    // visually identical — both use the amber away styling. The on-the-wire
    // enum keeps them distinct so the audit log can tell us whether the
    // user said so or whether the resolver inferred it.
    const STATUS_DOT_MAP: Record<string, string> = {
        available: s["dot-online"],
        busy: s["dot-busy"],
        dnd: s["dot-dnd"],
        brb: s["dot-away"],
        away: s["dot-away"],
        offline: s["dot-offline"],
        in_call: s["dot-in-call"],
        in_meeting: s["dot-in-meeting"],
    };
    const statusDotClass = STATUS_DOT_MAP[myStatus] || s["dot-offline"];

    const STATUS_META_MAP: Record<string, StatusMeta> = {
        available: {
            label:
                workState === "on_floor"
                    ? workMode === "remote"
                        ? "Working Remotely"
                        : "Working"
                    : "Available",
            glyph: "check",
        },
        busy: { label: "Busy", glyph: "dot" },
        dnd: { label: "Do Not Disturb", glyph: "minus" },
        brb: { label: "Away", glyph: "clock" },
        away: { label: "Away", glyph: "clock" },
        offline: { label: "Offline", glyph: "ring" },
        in_call: { label: "In a Call", glyph: "dot" },
        in_meeting: { label: "In a Meeting", glyph: "dot" },
    };
    const statusMeta = STATUS_META_MAP[myStatus] || STATUS_META_MAP.available;

    const renderStatusGlyph = (glyph: Glyph, className: string) => {
        if (glyph === "check") {
            return (
                <MaterialCheck size={10} className={className} aria-hidden="true" />
            );
        }
        if (glyph === "minus") {
            return (
                <MaterialMinus size={10} className={className} aria-hidden="true" />
            );
        }
        if (glyph === "clock") {
            return (
                <MaterialClock size={10} className={className} aria-hidden="true" />
            );
        }
        if (glyph === "ring") {
            return (
                <MaterialCircle size={10} className={className} aria-hidden="true" />
            );
        }
        return <span className={s["status-glyph-dot"]} aria-hidden="true" />;
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            alert("File is too large. Maximum size is 5MB.");
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }
        setUploading(true);
        try {
            const { data } = await uploadAvatar(file);
            updateUser({ avatar: data.avatar });
        } catch (err: any) {
            alert(err.response?.data?.error || "Avatar upload failed. Please try again.");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const confirmRemoveAvatar = async () => {
        try {
            await removeAvatar();
            updateUser({ avatar: null });
        } catch (err: any) {
            alert(err.response?.data?.error || "Failed to remove photo. Please try again.");
        } finally {
            setRemoveAvatarConfirming(false);
        }
    };

    const confirmSignOut = async () => {
        if (workState === "on_floor" || workState === "on_break") {
            if (workMode === "office") {
                setSignoutConfirming(false);
                alert("Please clock out from the Work Timer before signing out. Office clock-out requires location and face verification.");
                return;
            }
            try {
                await apiClockOut();
            } catch (err: any) {
                alert(err.response?.data?.error || "Clock-out failed. Please clock out from the Work Timer before signing out.");
                setSignoutConfirming(false);
                return;
            }
        }
        logout();
    };

    const handleRealmSwitch = async () => {
        const password = window.prompt("Enter your platform password to switch workspace:");
        if (!password) return;
        setSwitchingRealm(true);
        try {
            const target = currentRealm() === "platform" ? "tenant" : "platform";
            const { data } = await switchRealm(target, password);
            if ((data as any).redirect) window.location.assign((data as any).redirect);
        } catch (err: any) {
            alert(err.response?.data?.error || "Could not switch workspace");
        } finally { setSwitchingRealm(false); }
    };

    return (
        <div className={s["profile-section"]} ref={profileRef}>
            <button
                className={s["profile-trigger"]}
                onClick={() => setProfileOpen((prev) => !prev)}
                aria-expanded={profileOpen}
                aria-haspopup="true"
            >
                <div className={s["profile-avatar-wrapper"]}>
                    {avatarUrl ? (
                        <img src={avatarUrl} alt="" className={s["profile-avatar-img"]} />
                    ) : (
                        <span className={s["profile-avatar-initials"]}>{initials}</span>
                    )}
                    <span className={`${s["profile-status-dot"]} ${statusDotClass}`}>
                        {renderStatusGlyph(statusMeta.glyph, s["status-glyph"])}
                    </span>
                </div>
                <span className={s["profile-name"]}>{user?.full_name}</span>
                <MaterialChevronDown size="12" className={`${s["profile-chevron-icon"]} ${profileOpen ? s.open : ""}`} width="12" height="12" />
            </button>

            {profileOpen && (
                <div className={s["profile-dropdown"]}>
                    <div className={s["profile-dropdown-header"]}>
                        <div className={s["profile-avatar-lg-wrapper"]}>
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="" className={s["profile-avatar-lg-img"]} />
                            ) : (
                                <span className={s["profile-avatar-lg-initials"]}>{initials}</span>
                            )}
                            <span className={`${s["profile-avatar-lg-status"]} ${statusDotClass}`}>
                                {renderStatusGlyph(statusMeta.glyph, s["status-glyph"])}
                            </span>
                            <button
                                className={s["profile-avatar-edit"]}
                                onClick={() => fileInputRef.current?.click()}
                                title="Change photo"
                            >
                                {uploading ? "\u22EF" : <Camera size={13} />}
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden-input"
                                onChange={handleAvatarUpload}
                            />
                        </div>
                        <div className={s["profile-dropdown-info"]}>
                            <div className={s["profile-dropdown-name"]}>{user?.full_name}</div>
                            <div className={s["profile-dropdown-user"]}>@{user?.username}</div>
                            {user?.email && (
                                <div className={s["profile-dropdown-email"]}>{user.email}</div>
                            )}
                            <div className={s["profile-dropdown-badges"]}>
                                <span
                                    className={`${s["dd-status-badge"]} ${
                                        s[`status-${myStatus}`] || ""
                                    }`}
                                >
                                    <span className={s["dd-status-glyph"]}>
                                        {renderStatusGlyph(statusMeta.glyph, s["status-glyph-badge"])}
                                    </span>
                                    {statusMeta.label}
                                </span>
                                {workState !== "logged_out" && (
                                    <span
                                        className={`${s["dd-mode-badge"]} ${
                                            s[`dd-mode-${workMode}`] || ""
                                        }`}
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "0.25rem",
                                        }}
                                    >
                                        {workMode === "office" ? (
                                            <Building2 size={12} />
                                        ) : (
                                            <House size={12} />
                                        )}
                                        {workMode === "office" ? "Office" : "Remote"}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className={s["profile-dropdown-status-picker"]}>
                        <StatusPicker />
                    </div>

                    <div className={s["profile-dropdown-body"]}>
                        <button
                            className={s["profile-dropdown-item"]}
                            onClick={() => {
                                setProfileOpen(false);
                                setEditModalOpen(true);
                            }}
                        >
                            <span className={s["dd-item-icon"]}>
                                <MaterialEdit size="16" width="16" height="16" />
                            </span>
                            Edit Profile
                        </button>
                        {avatarUrl && (
                            <button
                                className={s["profile-dropdown-item"]}
                                onClick={() => {
                                    setProfileOpen(false);
                                    setRemoveAvatarConfirming(true);
                                }}
                            >
                                <span className={s["dd-item-icon"]}>
                                    <MaterialTrash2 size="16" width="16" height="16" />
                                </span>
                                Remove Photo
                            </button>
                        )}
                        <button
                            className={s["profile-dropdown-item"]}
                            onClick={() => {
                                setProfileOpen(false);
                                setSoundsModalOpen(true);
                            }}
                        >
                            <span className={s["dd-item-icon"]}>
                                <Bell size={14} />
                            </span>
                            Notification Sounds
                        </button>
                        <Link
                            to="/profile/face"
                            className={s["profile-dropdown-item"]}
                            onClick={() => setProfileOpen(false)}
                            style={{ textDecoration: "none", color: "inherit", display: "flex" }}
                        >
                            <span className={s["dd-item-icon"]}>
                                <ScanFace size={14} />
                            </span>
                            Face Enrollment
                        </Link>
                        <button className={s["profile-dropdown-item"]} onClick={toggleTheme}>
                            <span className={s["dd-item-icon"]}>
                                {theme === "dark" ? <MaterialSun size={16} /> : <MaterialMoon size={16} />}
                            </span>
                            {theme === "dark" ? "Light Mode" : "Dark Mode"}
                        </button>
                        {window.electronAPI && (
                            <button
                                className={s["profile-dropdown-item"]}
                                onClick={() => {
                                    setProfileOpen(false);
                                    window.dispatchEvent(new Event("workpulse-check-update"));
                                }}
                            >
                                <span className={s["dd-item-icon"]}>
                                    <MaterialRefreshCw size="16" width="16" height="16" />
                                </span>
                                Check for Updates
                            </button>
                        )}
                    </div>

                    <div className={s["profile-dropdown-divider"]} />

                    <Link
                        to="/privacy"
                        className={s["profile-dropdown-item"]}
                        onClick={() => setProfileOpen(false)}
                        style={{ textDecoration: "none", color: "inherit", display: "flex" }}
                    >
                        <span className={s["dd-item-icon"]}>
                            <ShieldCheck size={14} />
                        </span>
                        Privacy Policy
                    </Link>
                    <Link
                        to="/terms"
                        className={s["profile-dropdown-item"]}
                        onClick={() => setProfileOpen(false)}
                        style={{ textDecoration: "none", color: "inherit", display: "flex" }}
                    >
                        <span className={s["dd-item-icon"]}>
                            <FileText size={14} />
                        </span>
                        Terms of Service
                    </Link>

                    <div className={s["profile-dropdown-divider"]} />

                    {user?.has_linked_realm && (
                        <button className={s["profile-dropdown-item"]} disabled={switchingRealm}
                            onClick={() => { setProfileOpen(false); handleRealmSwitch(); }}>
                            <span className={s["dd-item-icon"]}><Repeat2 size={14} /></span>
                            {switchingRealm ? "Switching…" : currentRealm() === "platform" ? "Switch to Workspace" : "Switch to Platform Console"}
                        </button>
                    )}

                    <button
                        className={s["profile-dropdown-signout"]}
                        onClick={() => {
                            setProfileOpen(false);
                            setSignoutConfirming(true);
                        }}
                    >
                        <span className={`${s["dd-item-icon"]} ${s["dd-signout-icon"]}`}>
                            <MaterialLogOut size="16" width="16" height="16" />
                        </span>
                        Sign Out
                    </button>
                </div>
            )}

            {editModalOpen && <EditProfileModal onClose={() => setEditModalOpen(false)} />}
            {soundsModalOpen && <NotificationSoundsModal onClose={() => setSoundsModalOpen(false)} />}

            <ConfirmDialog
                isOpen={signoutConfirming}
                title="Sign Out"
                message="Are you sure you want to sign out?"
                confirmText="Sign Out"
                isDanger
                onConfirm={confirmSignOut}
                onCancel={() => setSignoutConfirming(false)}
            />
            <ConfirmDialog
                isOpen={removeAvatarConfirming}
                title="Remove Photo"
                message="Are you sure you want to remove your profile photo?"
                confirmText="Remove"
                isDanger
                onConfirm={confirmRemoveAvatar}
                onCancel={() => setRemoveAvatarConfirming(false)}
            />
        </div>
    );
}