<script lang="ts">
	// Shows `value`, or the browser's time zone when there isn't one yet. A page that binds `value`
	// gets the time zone picked, as the Household page does to keep it when its data reloads
	// (MEA-130).
	let { timeZones, value = $bindable() }: { timeZones: string[]; value?: string } = $props();

	let browserTimeZone = $state<string | null>(null);
	$effect(() => {
		browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	});

	const shown = $derived(value ?? browserTimeZone ?? 'UTC');
</script>

<select
	id="timeZone"
	name="timeZone"
	bind:value={() => shown, (picked) => (value = picked)}
	required
>
	{#if !timeZones.includes(shown)}
		<option value={shown}>{shown}</option>
	{/if}
	{#each timeZones as timeZone (timeZone)}
		<option value={timeZone}>{timeZone.replaceAll('_', ' ')}</option>
	{/each}
</select>
