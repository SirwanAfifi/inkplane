export function coalescedEvents(event: PointerEvent): PointerEvent[] {
  if (typeof event.getCoalescedEvents !== "function") return [event];
  const samples = [...event.getCoalescedEvents()];
  if (samples.length === 0) return [event];
  return samples
    .map((sample, index) => ({ sample, index }))
    .sort((first, second) =>
      first.sample.timeStamp - second.sample.timeStamp || first.index - second.index
    )
    .map(({ sample }) => sample);
}
