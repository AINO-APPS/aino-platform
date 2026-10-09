import { Users } from "lucide-react";
import s from "./GroupAvatar.module.css";

export interface GroupAvatarMember {
    name?: string | null;
    avatar?: string | null;
}

interface Tile {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Collage layout (Android `groupAvatarTiles`): 1 full, 2 split, 3 = 1 + 2 stacked, 4 quadrants. */
export function groupAvatarTiles(count: number): Tile[] {
    if (count <= 0) return [];
    if (count === 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
    if (count === 2) return [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }];
    if (count === 3)
        return [
            { x: 0, y: 0, w: 0.5, h: 1 },
            { x: 0.5, y: 0, w: 0.5, h: 0.5 },
            { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
        ];
    return [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
}

const PALETTE = ["#2383E2", "#0F9D7A", "#8B5CF6", "#E0702B", "#D9466F", "#4F6BED", "#2E9E5B", "#8A6D3B"];

/** Stable hue for a key (conversation id), same palette as Android. */
export function groupAvatarColor(key: string | number): string {
    const str = String(key);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(hash % PALETTE.length)];
}

/** Photos first (they read best small), then initials, at most four. */
export function collageMembers(members: GroupAvatarMember[]): GroupAvatarMember[] {
    return [...members].sort((a, b) => Number(!a.avatar) - Number(!b.avatar)).slice(0, 4);
}

function initials(name?: string | null): string {
    return (name || "?")
        .split(" ")
        .filter(Boolean)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

interface GroupAvatarProps {
    name?: string | null;
    photo?: string | null;
    members?: GroupAvatarMember[];
    colorKey: string | number;
    size?: number;
}

/**
 * Automatic group avatar (Android `GroupAvatar`): the uploaded group photo,
 * otherwise a collage of up to four members, otherwise a group glyph.
 */
export default function GroupAvatar({ name, photo, members = [], colorKey, size = 40 }: GroupAvatarProps) {
    const style = { width: size, height: size, fontSize: Math.max(9, size * 0.3) };
    if (photo) {
        return (
            <div className={s.wrap} style={style}>
                <img src={photo} alt={name || "Group"} className={s.img} />
            </div>
        );
    }
    const picked = collageMembers(members);
    if (picked.length === 0) {
        return (
            <div className={s.wrap} style={{ ...style, background: groupAvatarColor(colorKey) }} aria-label={name || "Group"}>
                <Users size={size * 0.48} color="#fff" />
            </div>
        );
    }
    const tiles = groupAvatarTiles(picked.length);
    const tileFont = picked.length === 1 ? size * 0.36 : size * 0.22;
    return (
        <div className={s.wrap} style={style} aria-label={name || "Group"}>
            {tiles.map((t, i) => {
                const m = picked[i];
                return (
                    <div
                        key={i}
                        className={s.tile}
                        style={{
                            left: `${t.x * 100}%`,
                            top: `${t.y * 100}%`,
                            width: `${t.w * 100}%`,
                            height: `${t.h * 100}%`,
                            background: m.avatar ? undefined : groupAvatarColor(`${colorKey}-${i}`),
                            fontSize: tileFont,
                        }}
                    >
                        {m.avatar ? <img src={m.avatar} alt={m.name || ""} className={s.img} /> : initials(m.name)}
                    </div>
                );
            })}
        </div>
    );
}
