<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';

	let { data } = $props();

	// The layout's dot was worked out before this page's load recorded it as seen.
	onMount(() => {
		invalidate('app:whats-new');
	});

	function formatReleased(date: string): string {
		return new Intl.DateTimeFormat('en-US', {
			timeZone: 'UTC',
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(`${date}T00:00:00Z`));
	}
</script>

<svelte:head>
	<title>What's new · Meals</title>
</svelte:head>

<h1>What's new</h1>

{#each data.releases as release (release.version)}
	<section class="card">
		<h2>{release.version}</h2>
		<p class="muted">Released {formatReleased(release.released)}</p>
		<ul>
			{#each release.lines as line, i (i)}
				<li>{line}</li>
			{/each}
		</ul>
	</section>
{/each}
