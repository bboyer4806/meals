<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import { formatDateLabel } from '#lib/dates.ts';

	let { data, form } = $props();

	let sendingTestEmail = $state(false);

	const created = (ms: number) => new Date(ms).toLocaleDateString();

	const PROPOSAL_STATUSES = {
		pending: 'Waiting for you',
		approved: 'Approved',
		rejected: 'Rejected',
		failed: 'Failed',
		expired: 'Expired'
	};

	function messageFor(action: string) {
		return form?.action === action ? form : null;
	}

	// Resend can take a few seconds to answer, and a second tap would send a second email.
	const sendTestEmail: SubmitFunction = ({ cancel }) => {
		if (sendingTestEmail) return cancel();
		sendingTestEmail = true;
		return async ({ update }) => {
			await update();
			sendingTestEmail = false;
		};
	};
</script>

<svelte:head>
	<title>Admin · Meals</title>
</svelte:head>

<h1>Admin</h1>

<section class="card">
	<h2>Backups</h2>
	{#if data.latestBackup}
		<p>Last nightly backup: <strong>{formatDateLabel(data.latestBackup)}</strong></p>
	{:else}
		<p class="error">No backups yet. The first one runs tonight at 03:00 server time.</p>
	{/if}
</section>

<section class="card">
	<h2>Email</h2>
	<p class="muted">Send yourself a test email to check that Meals can send email.</p>
	<form method="POST" action="?/testEmail" use:enhance={sendTestEmail}>
		<button class="primary" disabled={sendingTestEmail}>
			{sendingTestEmail ? 'Sending…' : 'Send test email'}
		</button>
	</form>
	{#if messageFor('testEmail')?.error}<p class="error" role="alert">{form?.error}</p>{/if}
	{#if messageFor('testEmail')?.message}<p role="status">{form?.message}</p>{/if}
</section>

<section class="card">
	<h2>AI assistants</h2>
	<p class="muted">
		ChatGPT and Claude can read every household's information and propose changes, which happen
		only when you approve them. To connect one, add a connector with this address, then allow it
		when Meals asks:
	</p>
	<p class="address">{data.mcpUrl}</p>
	{#if data.connections.length > 0}
		<ul class="list">
			{#each data.connections as connection (connection.id)}
				<li class="row">
					<span class="grow">
						<strong>{connection.name}</strong>
						<span class="muted">
							connected {created(connection.authorizedAt)}{connection.lastUsedAt === null
								? ''
								: `, last used ${created(connection.lastUsedAt)}`}
						</span>
					</span>
					<form method="POST" action="?/revokeConnection" use:enhance>
						<input type="hidden" name="id" value={connection.id} />
						<ConfirmButton
							label="Revoke"
							message={`Revoke ${connection.name}'s connection? It stops working right away, and its proposed changes are deleted.`}
							confirmLabel="Revoke"
							danger
						/>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">None connected.</p>
	{/if}
	<h3>Proposed changes</h3>
	{#if data.proposals.length > 0}
		<ul class="list">
			{#each data.proposals as proposal (proposal.id)}
				<li>
					<a href="/ai/proposals/{proposal.id}">{proposal.summary}</a>
					<div class="muted">
						{proposal.name} · {proposal.changeCount}
						{proposal.changeCount === 1 ? 'change' : 'changes'} · {created(proposal.createdAt)} ·
						{PROPOSAL_STATUSES[proposal.status]}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">None yet.</p>
	{/if}
</section>

<section class="card">
	<h2>Invite a household</h2>
	<p class="muted">They'll set up their own household the first time they sign in.</p>
	<form method="POST" action="?/invite" use:enhance class="row">
		<label class="visually-hidden" for="household-email">Email</label>
		<input
			class="grow"
			id="household-email"
			name="email"
			type="email"
			required
			autocomplete="off"
			placeholder="Their Google email"
		/>
		<button class="primary">Invite</button>
	</form>
	{#if messageFor('invite')?.error}<p class="error" role="alert">{form?.error}</p>{/if}
	{#if messageFor('invite')?.message}<p role="status">{form?.message}</p>{/if}
	{#if data.invites.length > 0}
		<p class="muted">Waiting for them to sign in:</p>
		<ul class="list">
			{#each data.invites as invite (invite.id)}
				<li class="row">
					<span class="grow">{invite.email}</span>
					<form method="POST" action="?/cancelInvite" use:enhance>
						<input type="hidden" name="id" value={invite.id} />
						<button class="quiet">Cancel</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card">
	<h2>Households</h2>
	<ul class="list">
		{#each data.households as household (household.id)}
			<li>
				<strong>{household.name}</strong>
				<div class="muted">{household.members ?? 'No members'}</div>
				<div class="muted">Since {created(household.createdAt)}</div>
			</li>
		{/each}
	</ul>
</section>

<style>
	.address {
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	h3 {
		font-size: 1rem;
		margin: 1rem 0 0.25rem;
	}
</style>
