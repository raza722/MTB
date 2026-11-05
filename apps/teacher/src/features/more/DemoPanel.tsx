import { teacherDemoApi, teacherQueries, type TeacherDemoState } from "@mtb/api";
import { resetDemoData } from "@mtb/mocks";
import { Button, Icon, Panel, Switch, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { clearPersisted } from "../../app/persist";
import { setSimulatedOffline, useSimulatedOffline } from "../../app/sync/network";
import { clearOutbox } from "../../app/sync/outbox";

/**
 * Presenter's switches, mock mode only (not part of the product): turn today into a holiday, take the phone offline,
 * make the next sync fail, play the principal approving change requests, reset the demo.
 */
export default function DemoPanel() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const offline = useSimulatedOffline();
  const demo = useQuery(teacherQueries.demo());
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["teacher"] });

  const set = useMutation({
    mutationFn: (body: Partial<TeacherDemoState>) => teacherDemoApi.set(body),
    onSuccess: (state) => {
      queryClient.setQueryData(teacherQueries.demo().queryKey, state);
      void refresh();
    },
  });
  const decide = useMutation({
    mutationFn: (approve: boolean) => teacherDemoApi.decideChanges(approve),
    onSuccess: (r, approve) => {
      void refresh();
      toast({ title: r.decided ? `${r.decided} ${r.decided === 1 ? "change" : "changes"} ${approve ? "approved" : "rejected"}` : "No changes were waiting", message: r.decided ? "As Mrs Sadia Rehman would from the staff dashboard." : undefined });
    },
  });

  const reset = async () => {
    resetDemoData();
    setSimulatedOffline(false);
    await clearOutbox();
    await clearPersisted();
    queryClient.clear();
    // Sign-in is real now and survives a reset of the fictional data: the teacher stays signed in.
    toast({ title: "Demo data reset", message: "Screens from modules not built yet start again from the demo data." });
    await navigate({ to: "/today" });
  };

  return (
    <Panel id="demo" title="Demo controls" description="For the presenter. Fictional data; resets when this tab closes." actions={<Icon name="bolt" className="text-ink-muted" />}>
      <div className="grid gap-4">
        <Switch
          label="Today is a holiday (Quaid-e-Azam Day)"
          checked={demo.data?.holiday ?? false}
          disabled={!demo.data || set.isPending}
          onChange={(e) => set.mutate({ holiday: e.target.checked })}
        />
        <Switch label="Go offline (the phone loses its signal)" checked={offline} onChange={(e) => setSimulatedOffline(e.target.checked)} />
        <Switch
          label="The next sync fails (server error)"
          checked={demo.data?.failNextSync ?? false}
          disabled={!demo.data || set.isPending}
          onChange={(e) => set.mutate({ failNextSync: e.target.checked })}
        />
        <div className="grid gap-2">
          <span className="mtb-label">Change requests</span>
          <div className="flex gap-2 [&>*]:flex-1">
            <Button size="touch" icon="check" loading={decide.isPending && decide.variables === true} onClick={() => decide.mutate(true)}>
              Approve all
            </Button>
            <Button size="touch" icon="x" loading={decide.isPending && decide.variables === false} onClick={() => decide.mutate(false)}>
              Reject all
            </Button>
          </div>
          <p className="m-0 text-small text-ink-muted">Plays the principal deciding from the staff dashboard.</p>
        </div>
        <Button size="touch" variant="danger-quiet" icon="refresh" onClick={() => void reset()}>
          Reset demo data
        </Button>
      </div>
    </Panel>
  );
}
