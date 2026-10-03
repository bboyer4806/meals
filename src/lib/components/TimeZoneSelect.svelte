<script lang="ts">
	// Starts on `value`, or on the browser's time zone when there isn't one yet.
	let { timeZones, value }: { timeZones: string[]; value?: string } = $props();

	let browserTimeZone = $state<string | null>(null);
	$effect(() => {
		browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	});

	const initial = $derived(value ?? browserTimeZone ?? 'UTC');
</script>

<select id="timeZone" name="timeZone" value={initial} required>
	{#if !timeZones.includes(initial)}
		<option value={initial}>{initial}</option>
	{/if}
	{#each timeZones as timeZone (timeZone)}
		<option value={timeZone}>{timeZone.replaceAll('_', ' ')}</option>
	{/each}
</select>
