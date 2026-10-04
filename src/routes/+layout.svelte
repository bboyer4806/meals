<script lang="ts">
	import '@fontsource-variable/nunito';
	import '@fontsource-variable/fraunces';
	import '../app.css';
	import { refreshAll } from '$app/navigation';

	let { children } = $props();

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
