import { useState } from "react";
import { useFeatures } from "../../../FeaturesContext";
import SignalDialog from "../../../components/chat/signal/SignalDialog";
import type { MuteDuration } from "../../../components/chat/signal/SignalMenu";
import GroupMainPage, { type GroupPage } from "./GroupMainPage";
import GroupMemberSheet from "./GroupMemberSheet";
import { AddMembersPage, EditInfoPage, GroupLinkPage, MembersPage, PermissionsPage, RequestsPage } from "./GroupSubPages";
import { TopBar } from "./SettingsUi";
import { useGroupSettings } from "./useGroupSettings";
import type { GroupMember } from "./groupPermissions";
import s from "./GroupSettings.module.css";

const TITLES: Record<GroupPage, string> = {
    main: "",
    edit: "Edit group",
    members: "Members",
    add: "Add members",
    link: "Group link",
    requests: "Requests & invites",
    permissions: "Permissions",
};

export interface GroupSettingsPanelProps {
    conv: any;
    currentUserId?: number | string;
    onClose: () => void;
    onChanged: () => void;
    onLeft: () => void;
    onVoiceCall: () => void;
    onVideoCall: () => void;
    onMute: (d: MuteDuration | null) => void;
    onSearch: () => void;
    onAllMedia: () => void;
    onPinned: () => void;
    onStarred: () => void;
    onClear: () => void;
    onMessageMember: (m: GroupMember) => void;
}

/** Full-height Android-style group settings with in-panel navigation. */
export default function GroupSettingsPanel(props: GroupSettingsPanelProps) {
    const { conv, currentUserId, onClose } = props;
    const { hasFeature } = useFeatures() as { hasFeature: (k: string) => boolean };
    const gs = useGroupSettings(conv, currentUserId, props.onChanged);
    const [page, setPage] = useState<GroupPage>("main");
    const [member, setMember] = useState<GroupMember | null>(null);
    const [confirmLeave, setConfirmLeave] = useState(false);
    const back = () => (page === "main" ? onClose() : setPage(page === "requests" && gs.link?.enabled ? "link" : "main"));
    const closeThen = (fn: () => void) => () => {
        onClose();
        fn();
    };

    return (
        <div className={s.panel} role="dialog" aria-label="Group settings">
            <TopBar title={TITLES[page]} onBack={back} />
            {gs.error && (
                <div className={s.error} role="alert">
                    {gs.error}
                </div>
            )}
            {page === "main" && (
                <div className={s.body}>
                    <GroupMainPage
                        gs={gs}
                        currentUserId={currentUserId}
                        callsEnabled={hasFeature("calls")}
                        onPage={setPage}
                        onMember={setMember}
                        onVoiceCall={closeThen(props.onVoiceCall)}
                        onVideoCall={closeThen(props.onVideoCall)}
                        onMute={props.onMute}
                        onSearch={closeThen(props.onSearch)}
                        onAllMedia={closeThen(props.onAllMedia)}
                        onPinned={closeThen(props.onPinned)}
                        onStarred={closeThen(props.onStarred)}
                        onLeave={() => setConfirmLeave(true)}
                        onClear={closeThen(props.onClear)}
                    />
                </div>
            )}
            {page === "edit" && <EditInfoPage gs={gs} onDone={() => setPage("main")} />}
            {page === "members" && <MembersPage gs={gs} currentUserId={currentUserId} onMember={setMember} />}
            {page === "add" && <AddMembersPage gs={gs} onDone={() => setPage("main")} />}
            {page === "link" && <GroupLinkPage gs={gs} onRequests={() => setPage("requests")} />}
            {page === "requests" && <RequestsPage gs={gs} />}
            {page === "permissions" && <PermissionsPage gs={gs} />}
            {member && (
                <GroupMemberSheet
                    member={member}
                    gs={gs}
                    currentUserId={currentUserId}
                    onMessage={closeThen(() => props.onMessageMember(member))}
                    onClose={() => setMember(null)}
                />
            )}
            {confirmLeave && (
                <SignalDialog
                    title="Leave group?"
                    message={
                        gs.perms.isOwner
                            ? "You're the owner. Ownership passes to an admin (or the longest-standing member) when you leave."
                            : "You will no longer be able to send or receive messages in this group."
                    }
                    onDismiss={() => setConfirmLeave(false)}
                    actions={[
                        { label: "Cancel", onClick: () => setConfirmLeave(false) },
                        {
                            label: "Leave",
                            danger: true,
                            onClick: async () => {
                                setConfirmLeave(false);
                                if (await gs.leave()) {
                                    onClose();
                                    props.onLeft();
                                }
                            },
                        },
                    ]}
                />
            )}
            {gs.toast && <div className={s.toast}>{gs.toast}</div>}
        </div>
    );
}
