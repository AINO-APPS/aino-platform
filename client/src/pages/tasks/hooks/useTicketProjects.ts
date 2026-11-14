import { useQueryClient } from "@tanstack/react-query";
import useRealtimeEvent from "../../../hooks/useRealtimeEvent";
import { useQuery } from "@tanstack/react-query";
import { getMyProjects, getProjects } from "../../../api/tasks";

const EMPTY: any[] = [];

export function useTicketProjects(user: any) {
    const client = useQueryClient();
    useRealtimeEvent(["project_updated"], () => {
        void client.invalidateQueries({ queryKey: ["tasks", "projects"] });
        void client.invalidateQueries({ queryKey: ["tasks", "myProjects"] });
        void client.invalidateQueries({ queryKey: ["tasks", "sprintList"] });
    });
    const { data: availableProjects = EMPTY, isFetched: projectsFetched } = useQuery({
        queryKey: ["tasks", "projects"],
        queryFn: async () => {
            const response = await getProjects(false);
            return Array.isArray(response.data) ? response.data as any[] : EMPTY;
        },
    });
    const { data: createProjects = EMPTY } = useQuery({
        queryKey: ["tasks", "myProjects", user?.tenant_id, user?.id],
        enabled: user != null,
        queryFn: async () => (await getMyProjects()).data as any[],
    });
    return { availableProjects, projectsFetched, createProjects };
}
