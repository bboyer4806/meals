<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import FormError from '#lib/components/FormError.svelte';
	import TimeZoneSelect from '#lib/components/TimeZoneSelect.svelte';

	let { data, form } = $props();

	// After a failure, such as an invite cancelled since the page opened, the page shows the
	// invites as they are now (6.1).
	const send: SubmitFunction = () => async ({ result, update }) => {
		await update();
		if (result.type === 'failure') await invalidateAll();
	};
</script>

<main class="page">
	<h1>Welcome, {data.name}</h1>
	<FormError {form} />
	{#if data.invites.length > 0}
		<p>
			{data.invites.length === 1
				? 'This household invited you to join it.'
				: 'These households invited you. You can belong to just one, so choose the one to join.'}
		</p>
		<div class="card">
			<ul class="list">
				{#each data.invites as invite (invite.id)}
					<li class="row">
						<strong class="grow">{invite.householdName}</strong>
						<form method="POST" action="?/join" use:enhance={send}>
							<input type="hidden" name="id" value={invite.id} />
							<button class="primary">Join</button>
						</form>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if data.mayStart}
		<p>
			{data.invites.length > 0 ? 'Or set up a household of your own.' : 'Set up your household.'}
			You can change these later.
		</p>
		<form method="POST" action="?/create" use:enhance={send} class="card">
			<div class="field">
				<label for="name">Household name</label>
				<input id="name" name="name" required maxlength="60" placeholder="The Smiths" />
			</div>
			<div class="field">
				<label for="defaultServings">Usual number of servings</label>
				<input
					id="defaultServings"
					name="defaultServings"
					type="number"
					inputmode="numeric"
					min="1"
					max="50"
					required
				/>
				<p class="muted">How many people you usually cook dinner for.</p>
			</div>
			<div class="field">
				<label for="timeZone">Time zone</label>
				<TimeZoneSelect timeZones={data.timeZones} />
			</div>
			<button class="primary">Create household</button>
		</form>
	{:else if data.invites.length === 0}
		<p>There's no invite waiting for <strong>{data.email}</strong> anymore.</p>
		<p>
			Ask someone to invite this address again, or sign in with the Google account you were invited
			with.
		</p>
		<a class="button primary" href="/login/google" data-sveltekit-reload>Use another account</a>
	{/if}
</main>
