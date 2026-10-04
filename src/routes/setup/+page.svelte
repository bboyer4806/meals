<script lang="ts">
	import { enhance } from '$app/forms';
	import FormError from '#lib/components/FormError.svelte';
	import TimeZoneSelect from '#lib/components/TimeZoneSelect.svelte';

	let { data, form } = $props();
</script>

<main class="page">
	<h1>Welcome, {data.name}</h1>
	<p>Set up your household. You can change these later.</p>
	<form method="POST" use:enhance class="card">
		<FormError {form} />
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
</main>
