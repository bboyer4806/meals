<script lang="ts">
	import '@fontsource-variable/nunito';
	import '@fontsource-variable/fraunces';
	import '../app.css';
	import { onMount } from 'svelte';
	import { afterNavigate, refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import { notePageBefore } from '#lib/return-to.ts';

	let { children } = $props();

	// How long coming back waits for the server to answer before keeping the page (MEA-80).
	const CHECK_TIMEOUT = 3000;

	// The page's data that a try to reload couldn't replace, kept raw so it stays the same object.
	// Anything that reloads the page or opens another brings new data, which ends the line (6.11).
	let unrefreshed = $state.raw<typeof page.data>();
	const stale = $derived(unrefreshed === page.data);

	// Marks the page once its script has started. Until then it's the server's page, which can't
	// ask before leaving or suggest as someone types, so browser tests wait for this mark.
	onMount(() => (document.documentElement.dataset.started = ''));

	// Which page came before each one, so a page can return to it without adding a Back step
	// (MEA-156).
	afterNavigate(notePageBefore);

	// Reload page data when someone comes back to the tab or app (Q11), once the server answers:
	// a reload that can't reach it puts an error page in place of this one and loses what was
	// typed. Without an answer the page stays as it is and says so (6.11, MEA-80).
	async function refresh() {
		if (document.visibilityState !== 'visible') return;
		// What was shown when it asked, so data that arrives meanwhile isn't called out of date.
		const shown = page.data;
		if (await serverAnswers()) await refreshAll();
		else unrefreshed = shown;
	}

	async function serverAnswers() {
		if (!navigator.onLine) return false;
		try {
			const response = await fetch('/healthz', { signal: AbortSignal.timeout(CHECK_TIMEOUT) });
			return response.ok;
		} catch {
			// No connection, or no answer in time.
			return false;
		}
	}

	// A page that couldn't reload tries again when the device's connection comes back, as well as
	// at the next return.
	function retry() {
		if (stale) refresh();
	}
</script>

<svelte:head>
	<title>Meals</title>
</svelte:head>

<svelte:document onvisibilitychange={refresh} />
<svelte:window ononline={retry} />

{@render children()}

{#if stale}
	<p class="stale no-print" role="status">Couldn't refresh</p>
{/if}

<style>
	/* Bottom left, level with the feedback button and above the tab bar (6.11). */
	.stale {
		position: fixed;
		left: 1rem;
		bottom: calc(var(--tabs-height) + 0.75rem + env(safe-area-inset-bottom));
		z-index: 20;
		display: flex;
		align-items: center;
		min-height: var(--feedback-size);
		margin: 0;
		padding: 0 1rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		box-shadow: var(--shadow);
		font-weight: 600;
	}
</style>
