# Supabase Backend Setup Guide for Safetrip Service Logistics

This guide will help you set up the complete backend infrastructure for your logistics application using Supabase.

## Prerequisites

1. A Supabase account (sign up at https://supabase.com)
2. A new Supabase project created
3. Access to the Supabase SQL Editor

## Setup Steps

### Step 1: Initial Database Setup

1. Go to your Supabase project dashboard
2. Navigate to the **SQL Editor** tab
3. Copy and paste the contents of `supabase_setup.sql` into the SQL Editor
4. Click **Run** to execute the script

This will create:
- `shipments` table for storing shipment data
- `shipment_tracking` table for tracking history
- `users_profiles` table for extended user information
- Row Level Security (RLS) policies
- Authentication triggers
- Sample data

### Step 2: Additional Functions and Views

1. In the same SQL Editor, copy and paste the contents of `supabase_functions.sql`
2. Click **Run** to execute the script

This will create:
- Helper functions for shipment management
- Analytics functions
- Performance indexes
- Additional views

### Step 3: Configure Authentication

1. Go to **Authentication** > **Settings** in your Supabase dashboard
2. Configure the following settings:

#### Email Settings
- **Enable email confirmations**: ON
- **Enable email change confirmations**: ON
- **Enable secure email change**: ON

#### User Management
- **Enable user signups**: ON
- **Enable email confirmations**: ON

#### URL Configuration
- **Site URL**: `http://localhost:3000` (or your domain)
- **Redirect URLs**: Add your application URLs

### Step 4: Get Your Project Credentials

1. Go to **Settings** > **API** in your Supabase dashboard
2. Copy the following values:
   - **Project URL** (supabaseUrl)
   - **anon public** key (supabaseKey)

3. Update your `script.js` file with these credentials:
```javascript
const supabaseUrl = 'YOUR_PROJECT_URL';
const supabaseKey = 'YOUR_ANON_KEY';
```

### Step 5: Test the Setup

1. Open your application in a browser
2. Try to sign up for a new account
3. Test the shipment registration functionality
4. Test the tracking functionality

## Database Schema Overview

### Tables

#### `shipments`
- Stores all shipment information
- Includes sender/receiver details, package info, and tracking data
- Protected by RLS policies

#### `shipment_tracking`
- Stores tracking history for each shipment
- Records status changes and location updates
- Linked to shipments via foreign key

#### `users_profiles`
- Extended user information beyond basic auth
- Automatically created when users sign up
- Includes company and contact details

### Key Functions

#### `search_shipment_by_tracking(tracking_number)`
- Public function to search shipments by tracking number
- Returns basic shipment information for public tracking

#### `update_shipment_status(shipment_id, status, location, description)`
- Updates shipment status and adds tracking record
- Used for status updates and location changes

#### `get_shipment_tracking(tracking_number)`
- Returns complete tracking history for a shipment
- Used in the tracking page

#### `get_user_shipment_stats(user_id)`
- Returns statistics for a user's shipments
- Useful for dashboard analytics

## Security Features

### Row Level Security (RLS)
- Users can only access their own shipments
- Public tracking search is available for tracking numbers
- All data is protected by appropriate policies

### Authentication
- Automatic user profile creation on signup
- Secure password requirements
- Email verification support

### Data Validation
- Tracking number format validation
- Required field constraints
- Data type validation

## API Usage Examples

### Register a Shipment
```javascript
const { data, error } = await supabase
    .from('shipments')
    .insert([{
        tracking_number: 'ST1234567890123',
        sender_name: 'John Doe',
        // ... other fields
    }]);
```

### Track a Shipment
```javascript
const { data, error } = await supabase
    .from('shipments')
    .select('*')
    .eq('tracking_number', 'ST1234567890123');
```

### Update Shipment Status
```javascript
const { data, error } = await supabase
    .rpc('update_shipment_status', {
        p_shipment_id: 'shipment-uuid',
        p_status: 'In Transit',
        p_location: 'Distribution Center',
        p_description: 'Package in transit'
    });
```

## Maintenance

### Cleanup Old Data
```sql
-- Clean up tracking records older than 1 year
SELECT public.cleanup_old_tracking_records(365);
```

### Monitor Performance
- Check the **Database** > **Logs** section for slow queries
- Monitor the **Database** > **Usage** section for resource usage

## Troubleshooting

### Common Issues

1. **RLS Policy Errors**: Make sure all policies are properly created
2. **Authentication Issues**: Check your project URL and API key
3. **Permission Errors**: Ensure functions have proper grants
4. **Tracking Not Found**: Verify tracking number format and existence

### Debug Steps

1. Check the Supabase logs for error messages
2. Verify your API credentials are correct
3. Test database queries directly in the SQL Editor
4. Check browser console for JavaScript errors

## Support

If you encounter issues:
1. Check the Supabase documentation
2. Review the error logs in your Supabase dashboard
3. Test individual functions in the SQL Editor
4. Verify your RLS policies are correctly configured

## Next Steps

After completing the setup:
1. Test all functionality thoroughly
2. Customize the sample data for your needs
3. Set up monitoring and alerts
4. Consider implementing additional features like:
   - Email notifications
   - SMS tracking updates
   - Advanced analytics
   - API rate limiting
