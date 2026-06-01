if (global.pause) 
{
	sprite_index = normal_sprite;
	draw_self();	
	exit;
}

// Inherit the parent event
event_inherited();

