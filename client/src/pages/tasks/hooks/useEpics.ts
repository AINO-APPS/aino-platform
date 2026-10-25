import { useEffect, useState } from "react";
import { getEpics } from "../../../api/tasks";

/**
 * Epic data for the Tasks area: the rollup list and the selected epic filter.
 *
 * The filter is part of the URL (`?epic=`), so an epic-filtered view can be
 * shared like any other.
 */
export function useEpics(epicFilter: string) {
    const [epics, setEpics] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getEpics()
            .then((res) => {
                if (!cancelled) setEpics(res.data?.epics || []);
            })
            .catch(() => {
                // An epic list failure must not block the Tasks page.
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const selectedEpicId = epicFilter || null;

    return { epics, loading, selectedEpicId };
}
