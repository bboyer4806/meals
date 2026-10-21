<script lang="ts">
	import '@fontsource-variable/nunito';
	import '@fontsource-variable/fraunces';
	import '../app.css';
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';

	let { children } = $props();

	// Marks the page once its script has started. Until then it's the server's page, which can't
	// ask before leaving or suggest as someone types, so browser tests wait for this mark.
	onMount(() => (document.documentElement.dataset.started = ''));

	// Reload page data when someone comes back to the tab or app (Q11).
	$effect(() => {
		const refresh = () => {
			if (document.visibilityState === 'visible') refreshAll();
		};
		document.addEventListener('visibilitychange', refresh);
		return () => document.removeEventListener('visibilitychange', refresh);
	});
</script>

<svelte:head>
	<title>Meals</title>
</svelte:head>

{@render children()}
