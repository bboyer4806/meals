<script lang="ts">
	import { enhance } from '$app/forms';
	import FormError from '#lib/components/FormError.svelte';

	let { data, form } = $props();

	const proposal = $derived(data.proposal);
	const decided = $derived(proposal.decidedAt === null ? '' : time(proposal.decidedAt));

	function time(ms: number): string {
		return new Date(ms).toLocaleString();
	}
</script>

<svelte:head>
	<title>Changes from {data.platform} · Meals</title>
</svelte:head>

<main class="page">
	<h1>Changes from {data.platform}</h1>
	<p>{proposal.summary}</p>
	<p class="muted">Proposed {time(proposal.createdAt)}</p>

	<div role="status">
		{#if proposal.status === 'pending'}
			<p>
				Nothing changes until you approve. Approve makes all {proposal.changes.length}
				{proposal.changes.length === 1 ? 'change' : 'changes'} together, or none if one can't be made.
			</p>
		{:else if proposal.status === 'approved'}
			<p class="outcome">Approved {decided}. The changes were made.</p>
		{:else if proposal.status === 'rejected'}
			<p class="outcome">Rejected {decided}. Nothing was changed.</p>
		{:else if proposal.status === 'failed'}
			<p class="outcome error">
				Couldn't be made {decided}, so nothing was changed. {proposal.error}
			</p>
		{:else}
			<p class="outcome">
				Expired {time(proposal.expiresAt)}, so it can't be approved. Ask {data.platform} for a new
				proposal.
			</p>
		{/if}
	</div>

	<ol class="changes">
		{#each proposal.changes as change, index (index)}
			<li class="card">
				<h2>{change.title}</h2>
				<p class="muted">
					{change.householdName} (household {change.householdId}){change.record === null
						? ''
						: ` · ${change.record}`}
				</p>
				{#if change.current.length > 0}
					<h3>Now</h3>
					<dl>
						{#each change.current as field (field.name)}
							<dt>{field.name}</dt>
							<dd>{field.value}</dd>
						{/each}
					</dl>
				{/if}
				{#if change.proposed.length > 0}
					<h3>{change.current.length > 0 ? 'Proposed' : 'New'}</h3>
					<dl>
						{#each change.proposed as field (field.name)}
							<dt>{field.name}</dt>
							<dd>{field.value}</dd>
						{/each}
					</dl>
				{/if}
			</li>
		{/each}
	</ol>

	{#if proposal.status === 'pending'}
		<form method="POST" use:enhance class="row">
			<input type="hidden" name="hash" value={proposal.hash} />
			<button class="primary" formaction="?/approve">Approve</button>
			<button formaction="?/reject">Reject</button>
		</form>
		<p class="muted">Expires {time(proposal.expiresAt)}</p>
	{/if}
	<FormError {form} />

	<p><a class="link-tap" href="/admin">Admin</a></p>
</main>

<style>
	.changes {
		padding: 0;
		list-style: none;
		counter-reset: change;
	}

	.changes h2 {
		font-size: 1.15rem;
		margin: 0;
		counter-increment: change;
	}

	.changes h2::before {
		content: counter(change) '. ';
	}

	h3 {
		font-size: 1rem;
		margin: 1rem 0 0.25rem;
	}

	dl {
		margin: 0;
	}

	dt {
		font-weight: 700;
	}

	dd {
		margin: 0 0 0.5rem;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.outcome {
		font-weight: 700;
	}
</style>
